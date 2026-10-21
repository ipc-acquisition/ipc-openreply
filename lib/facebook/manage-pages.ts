import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import {
  getSystemUser,
  hasRequiredPageTasks,
  listSystemUserPages,
  subscribePageToWebhooks,
  unsubscribePageFromWebhooks,
} from "@/lib/meta/page-client";
import { ConnectionError } from "@/lib/facebook/connection-error";

/**
 * Facebook Pages are connected through a Business Manager system user. The
 * owner pastes its token once (saveSystemUserToken); every Page assigned to
 * that user can then be connected as an InstagramAccount with provider
 * FACEBOOK_PAGE and subscribed to the webhook. The token never leaves the
 * server: this module only ever returns Page names, ids and flags.
 */

export interface FacebookPageOption {
  id: string;
  name: string;
  tasks: string[];
  /** The system user holds the tasks the product needs on this Page. */
  eligible: boolean;
  connected: boolean;
  accountId?: string;
  webhookSubscribed?: boolean;
}

export interface FacebookPagesState {
  configured: boolean;
  systemUser?: { id: string; name?: string };
  pages: FacebookPageOption[];
  /** Pages connected earlier that the system user no longer lists. */
  orphaned: Array<{ accountId: string; pageId: string; name: string; webhookSubscribed: boolean }>;
}

async function loadSystemUserToken(workspaceId: string) {
  const connection = await prisma.facebookPageConnection.findUnique({
    where: { workspaceId },
    select: { systemUserToken: true, systemUserId: true },
  });
  if (!connection) throw new ConnectionError("Save the system user token first.");
  return { token: decryptToken(connection.systemUserToken), systemUserId: connection.systemUserId };
}

function connectedPagesOf(workspaceId: string) {
  return prisma.instagramAccount.findMany({
    where: { workspaceId, provider: "FACEBOOK_PAGE" },
    select: { id: true, instagramId: true, username: true, webhookSubscribed: true },
  });
}

export async function getFacebookPagesState(workspaceId: string): Promise<FacebookPagesState> {
  const connection = await prisma.facebookPageConnection.findUnique({
    where: { workspaceId },
    select: { systemUserToken: true, systemUserId: true },
  });
  if (!connection) return { configured: false, pages: [], orphaned: [] };

  const token = decryptToken(connection.systemUserToken);
  const [systemUser, pages, connected] = await Promise.all([
    getSystemUser(token),
    listSystemUserPages(token),
    connectedPagesOf(workspaceId),
  ]);
  const byPageId = new Map(connected.map((a) => [a.instagramId, a]));
  const listed = new Set(pages.map((p) => p.id));

  return {
    configured: true,
    systemUser: { id: systemUser.id, name: systemUser.name },
    pages: pages.map((p) => {
      const account = byPageId.get(p.id);
      return {
        id: p.id,
        name: p.name,
        tasks: p.tasks ?? [],
        eligible: hasRequiredPageTasks(p),
        connected: Boolean(account),
        ...(account ? { accountId: account.id, webhookSubscribed: account.webhookSubscribed } : {}),
      };
    }),
    orphaned: connected
      .filter((a) => !listed.has(a.instagramId))
      .map((a) => ({
        accountId: a.id,
        pageId: a.instagramId,
        name: a.username,
        webhookSubscribed: a.webhookSubscribed,
      })),
  };
}

/** Validates the token against Meta before storing it encrypted. */
export async function saveSystemUserToken(workspaceId: string, token: string) {
  const [systemUser] = await Promise.all([getSystemUser(token), listSystemUserPages(token)]);
  await prisma.facebookPageConnection.upsert({
    where: { workspaceId },
    create: { workspaceId, systemUserToken: encryptToken(token), systemUserId: systemUser.id },
    update: { systemUserToken: encryptToken(token), systemUserId: systemUser.id },
  });
  return { systemUserId: systemUser.id, name: systemUser.name };
}

export async function connectFacebookPage(workspaceId: string, pageId: string) {
  const { token } = await loadSystemUserToken(workspaceId);
  const page = (await listSystemUserPages(token)).find((p) => p.id === pageId);
  if (!page) throw new ConnectionError("That Page is not assigned to the system user.", 403);
  if (!hasRequiredPageTasks(page)) {
    throw new ConnectionError("The system user needs the MESSAGING and MODERATE tasks on this Page.", 403);
  }

  const existing = await prisma.instagramAccount.findUnique({ where: { instagramId: pageId } });
  if (existing && (existing.workspaceId !== workspaceId || existing.provider !== "FACEBOOK_PAGE")) {
    throw new ConnectionError("This Page is already connected elsewhere.", 409);
  }

  let webhookSubscribed = false;
  try {
    webhookSubscribed = Boolean((await subscribePageToWebhooks(pageId, page.access_token)).success);
  } catch (error) {
    console.warn("[Facebook Pages] Webhook subscription failed:", error);
  }

  const data = {
    username: page.name,
    name: page.name,
    accessToken: encryptToken(page.access_token),
    // Page tokens from a system user do not expire.
    tokenExpiresAt: null,
    webhookSubscribed,
  };
  if (existing) {
    await prisma.instagramAccount.update({ where: { id: existing.id }, data });
    return { accountId: existing.id, webhookSubscribed };
  }
  const created = await prisma.instagramAccount.create({
    data: { ...data, workspaceId, instagramId: pageId, provider: "FACEBOOK_PAGE" },
    select: { id: true },
  });
  return { accountId: created.id, webhookSubscribed };
}

async function loadPageAccount(workspaceId: string, accountId: string) {
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, workspaceId, provider: "FACEBOOK_PAGE" },
    select: { id: true, instagramId: true, accessToken: true },
  });
  if (!account) throw new ConnectionError("That Page is not connected to this workspace.", 404);
  return account;
}

export async function resubscribeFacebookPage(workspaceId: string, accountId: string) {
  const account = await loadPageAccount(workspaceId, accountId);
  const result = await subscribePageToWebhooks(account.instagramId, decryptToken(account.accessToken));
  const webhookSubscribed = Boolean(result.success);
  await prisma.instagramAccount.update({ where: { id: account.id }, data: { webhookSubscribed } });
  return { webhookSubscribed };
}

export async function disconnectFacebookPage(workspaceId: string, accountId: string) {
  const account = await loadPageAccount(workspaceId, accountId);
  try {
    await unsubscribePageFromWebhooks(account.instagramId, decryptToken(account.accessToken));
  } catch (error) {
    // The row goes away regardless; a stale subscription only produces
    // webhooks that no longer match any account.
    console.warn("[Facebook Pages] Webhook unsubscribe failed:", error);
  }
  await prisma.instagramAccount.deleteMany({ where: { id: account.id, workspaceId } });
}

export async function removeFacebookConnection(workspaceId: string) {
  const connected = await prisma.instagramAccount.count({
    where: { workspaceId, provider: "FACEBOOK_PAGE" },
  });
  if (connected > 0) throw new ConnectionError("Disconnect this workspace's Pages first.");
  await prisma.facebookPageConnection.deleteMany({ where: { workspaceId } });
}
