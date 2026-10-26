import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { exchangeFacebookCode, getLongLivedUserToken, inspectUserToken } from "@/lib/facebook/login";
import { saveUserConnection } from "@/lib/facebook/manage-pages";
import { verifyOAuthState } from "@/lib/meta/oauth";
import { getSystemUser } from "@/lib/meta/page-client";
import { canManageWorkspace } from "@/lib/workspace-access";

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl();
  const settings = (status: string, extra: Record<string, string> = {}) =>
    NextResponse.redirect(`${baseUrl}/settings?${new URLSearchParams({ facebook: status, ...extra })}`);

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return settings("denied");

  const code = params.get("code");
  const state = verifyOAuthState(params.get("state"));
  if (!code || !state) return settings("invalid");

  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(`${baseUrl}/login`);

  // The state names a workspace; the person finishing the login must still be
  // allowed to manage it, or a stolen state could attach their token elsewhere.
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: state.workspaceId, userId: session.user.id },
  });
  if (!membership || !canManageWorkspace(membership.role)) return settings("forbidden");

  try {
    // Must be byte-identical to the redirect_uri the dialog was opened with.
    const redirectUri = `${baseUrl}/api/facebook/callback`;
    const shortLived = await exchangeFacebookCode(code, redirectUri);
    const longLived = await getLongLivedUserToken(shortLived.access_token);
    const [owner, info] = await Promise.all([
      getSystemUser(longLived.access_token),
      inspectUserToken(longLived.access_token),
    ]);
    const tokenExpiresAt =
      info.expiresAt ??
      (longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : null);

    const { pages } = await saveUserConnection(state.workspaceId, {
      token: longLived.access_token,
      ownerId: owner.id,
      ownerName: owner.name ?? null,
      tokenExpiresAt,
      dataAccessExpiresAt: info.dataAccessExpiresAt,
    });
    return settings(pages > 0 ? "connected" : "no_pages");
  } catch (error) {
    // Meta errors carry the path but never the query string (code, secret,
    // tokens), so the message is safe to store and to put in the redirect.
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Facebook Login] Error:", error);
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: state.workspaceId,
          message: "Facebook connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});
    return settings("failed", { reason: message.slice(0, 200) });
  }
}
