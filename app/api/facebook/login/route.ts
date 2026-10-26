import { NextResponse } from "next/server";
import { getBaseUrl, getMissingFacebookLoginEnv } from "@/lib/env";
import { getFacebookLoginUrl } from "@/lib/facebook/login";
import { createOAuthState } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

// Starts "Connect with Facebook". A plain <a> navigation, so every failure is a
// redirect back to Settings with a status the notice can explain.
export async function GET() {
  const baseUrl = getBaseUrl();
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.redirect(`${baseUrl}/login`);
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=forbidden`);
  }

  const missing = getMissingFacebookLoginEnv();
  if (missing.length > 0) {
    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=misconfigured&missing=${encodeURIComponent(missing.join(","))}`
    );
  }

  const state = createOAuthState(context.workspaceId);
  return NextResponse.redirect(getFacebookLoginUrl(`${baseUrl}/api/facebook/callback`, state));
}
