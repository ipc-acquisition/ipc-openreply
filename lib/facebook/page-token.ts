import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { listSystemUserPages } from "@/lib/meta/page-client";

/**
 * Re-reads a Page's token from the workspace's saved Facebook token (GET
 * /me/accounts) and stores it on the account, so a Page token Meta rejected
 * (code 190) can be regenerated without a human step. That works while the
 * saved token itself is valid: system user tokens do not expire, and a "Connect
 * with Facebook" token lasts about 60 days. Returns true when a token was
 * saved; false when the account is not a Page, the workspace has no Facebook
 * connection, or the token no longer lists the Page.
 */
export async function refreshFacebookPageToken(accountConnectionId: string): Promise<boolean> {
  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountConnectionId },
    select: { id: true, instagramId: true, provider: true, workspaceId: true },
  });
  if (!account || account.provider !== "FACEBOOK_PAGE") return false;

  const connection = await prisma.facebookPageConnection.findUnique({
    where: { workspaceId: account.workspaceId },
    select: { systemUserToken: true },
  });
  if (!connection) return false;

  const pages = await listSystemUserPages(decryptToken(connection.systemUserToken));
  const page = pages.find((p) => p.id === account.instagramId);
  if (!page?.access_token) {
    await prisma.operationalEvent.create({
      data: {
        workspaceId: account.workspaceId,
        source: "WORKER",
        level: "WARNING",
        message: `Page ${account.instagramId} is no longer listed by the saved Facebook connection; its token could not be refreshed`,
        payload: { instagramAccountId: account.instagramId },
      },
    });
    return false;
  }

  await prisma.instagramAccount.update({
    where: { id: account.id },
    data: { accessToken: encryptToken(page.access_token), tokenExpiresAt: null },
  });
  return true;
}
