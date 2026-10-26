import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import {
  getSystemUser,
  hasRequiredPageTasks,
  listSystemUserPages,
  subscribePageToWebhooks,
  unsubscribePageFromWebhooks,
  type FacebookPage,
} from "@/lib/meta/page-client";
import { ConnectionError } from "@/lib/facebook/connection-error";

/**
 * Facebook Pages are read from one stored token per workspace: either the
 * long-lived token of the person who clicked "Connect with Facebook"
 * (saveUserConnection, the default) or a Business Manager system user token
 * pasted by the owner (saveSystemUserToken). Every Page the token lists can be
 * connected as an InstagramAccount with provider FACEBOOK_PAGE and subscribed
 * to the webhook. The token never leaves the server: this module only ever
 * returns Page names, ids, flags and expiry dates.
 */

export interface FacebookPageOption {
  id: string;
  name: string;
  tasks: string[];
  /** The token's owner holds the tasks the product needs on this Page. */
  eligible: boolean;
  connected: boolean;
  accountId?: string;
  webhookSubscribed?: boolean;
}

export interface FacebookPagesState {
  configured: boolean;
  tokenKind?: "SYSTEM_USER" | "USER";
  /** The system user or person behind the stored token. */
  systemUser?: { id: string; name?: string };
  tokenExpiresAt?: string | null;
  dataAccessExpiresAt?: string | null;
  pages: FacebookPageOption[];
  /** Pages connected earlier that the stored token no longer lists. */
  orphaned: Array<{ accountId: string; pageId: string; name: string; webhookSubscribed: boolean }>;
}

/**
 * Re-reads the Page tokens of already connected Pages from a newly saved
 * token, so replacing or reconnecting the token never requires disconnecting a
 * Page (which would cascade-delete its campaigns, flows and logs). Pages the
 * new token does not list keep their old token and show up as orphaned.
 */
async function refreshConnectedPageTokens(workspaceId: string, pages: FacebookPage[]) {
  const connected = await connectedPagesOf(workspaceId);
  const byPageId = new Map(pages.map((p) => [p.id, p]));
  let refreshed = 0;
  for (const account of connected) {
    const page = byPageId.get(account.instagramId);
    if (!page?.access_token) continue;
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { accessToken: encryptToken(page.access_token), tokenExpiresAt: null },
    });
    refreshed++;
  }
  return refreshed;
}

async function loadSystemUserToken(workspaceId: string) {
  const connection = await prisma.facebookPageConnection.findUnique({
    where: { workspaceId },
    select: { systemUserToken: true, systemUserId: true },
  });
  if (!connection) throw new ConnectionError("Connect with Facebook or save a system user token first.");
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
    select: {
      systemUserToken: true,
      systemUserId: true,
      tokenKind: true,
      tokenExpiresAt: true,
      dataAccessExpiresAt: true,
    },
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
    tokenKind: connection.tokenKind,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    dataAccessExpiresAt: connection.dataAccessExpiresAt?.toISOString() ?? null,
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
  const [systemUser, pages] = await Promise.all([getSystemUser(token), listSystemUserPages(token)]);
  const data = {
    systemUserToken: encryptToken(token),
    systemUserId: systemUser.id,
    tokenKind: "SYSTEM_USER" as const,
    ownerName: systemUser.name ?? null,
    tokenExpiresAt: null,
    dataAccessExpiresAt: null,
  };
  await prisma.facebookPageConnection.upsert({
    where: { workspaceId },
    create: { workspaceId, ...data },
    update: data,
  });
  await refreshConnectedPageTokens(workspaceId, pages);
  return { systemUserId: systemUser.id, name: systemUser.name };
}

/**
 * Stores the long-lived token from "Connect with Facebook". The callback has
 * already exchanged and inspected it; this lists the Pages once more to prove
 * the token works before replacing whatever was saved.
 */
export async function saveUserConnection(
  workspaceId: string,
  input: {
    token: string;
    ownerId: string;
    ownerName: string | null;
    tokenExpiresAt: Date | null;
    dataAccessExpiresAt: Date | null;
  }
) {
  const pages = await listSystemUserPages(input.token);
  const data = {
    systemUserToken: encryptToken(input.token),
    systemUserId: input.ownerId,
    tokenKind: "USER" as const,
    ownerName: input.ownerName,
    tokenExpiresAt: input.tokenExpiresAt,
    dataAccessExpiresAt: input.dataAccessExpiresAt,
  };
  await prisma.facebookPageConnection.upsert({
    where: { workspaceId },
    create: { workspaceId, ...data },
    update: data,
  });
  const refreshed = await refreshConnectedPageTokens(workspaceId, pages);
  return { pages: pages.length, refreshed };
}

export async function connectFacebookPage(workspaceId: string, pageId: string) {
  const { token } = await loadSystemUserToken(workspaceId);
  const page = (await listSystemUserPages(token)).find((p) => p.id === pageId);
  if (!page) throw new ConnectionError("That Page is not available to the saved Facebook connection.", 403);
  if (!hasRequiredPageTasks(page)) {
    throw new ConnectionError("The connected account needs the MESSAGING and MODERATE tasks on this Page.", 403);
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
