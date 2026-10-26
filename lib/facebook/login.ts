/**
 * "Connect with Facebook": Facebook Login for Business with a user access token
 * configuration. The person who logs in picks the Pages; their short-lived
 * token is exchanged for a long-lived one (about 60 days), and the Page tokens
 * read from it (GET /me/accounts) have no fixed expiry.
 *
 * Why not only a system user: under Standard Access Meta lets an app message
 * people without a role on it only when the token comes from someone who has a
 * role (observed 2026-10-24: a system-user Page token got code=10 "Cannot
 * message users who are not admins, developers or testers"; the same message
 * with a Page token from the app admin went through).
 *
 * The app secret, the code and the tokens travel in query strings here because
 * the OAuth endpoints are GET-only. handleResponse drops the query string from
 * error messages, so none of them can end up in a log or a redirect.
 */
import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";
import { facebookGraphBase, handleResponse } from "@/lib/meta/client";

const REQUEST_TIMEOUT_MS = 15_000;

export function getFacebookLoginUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    // Facebook Login for Business: config_id replaces scope. Permissions and
    // the asset picker come from the configuration in the App Dashboard.
    config_id: requireEnv("FACEBOOK_LOGIN_CONFIG_ID"),
  });
  return `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

async function graphGetWithParams<T>(path: string, params: Record<string, string>) {
  const url = new URL(`${facebookGraphBase()}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return handleResponse<T>(response);
}

/** Exchanges the login code. redirect_uri must match the one sent to the dialog. */
export async function exchangeFacebookCode(code: string, redirectUri: string): Promise<TokenResponse> {
  return graphGetWithParams<TokenResponse>("oauth/access_token", {
    client_id: requireEnv("FACEBOOK_APP_ID"),
    client_secret: requireEnv("FACEBOOK_APP_SECRET"),
    redirect_uri: redirectUri,
    code,
  });
}

export async function getLongLivedUserToken(shortLivedToken: string): Promise<TokenResponse> {
  return graphGetWithParams<TokenResponse>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: requireEnv("FACEBOOK_APP_ID"),
    client_secret: requireEnv("FACEBOOK_APP_SECRET"),
    fb_exchange_token: shortLivedToken,
  });
}

export interface UserTokenInfo {
  userId: string;
  /** null when Meta reports no expiry (expires_at = 0). */
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
}

function fromUnixSeconds(value: number | undefined): Date | null {
  return value && value > 0 ? new Date(value * 1000) : null;
}

/**
 * Reads the token's expiry dates and checks that it was issued to this app, so
 * a token minted for another app can never be stored as ours.
 */
export async function inspectUserToken(userToken: string): Promise<UserTokenInfo> {
  const appId = requireEnv("FACEBOOK_APP_ID");
  const result = await graphGetWithParams<{
    data?: {
      app_id?: string;
      is_valid?: boolean;
      user_id?: string;
      expires_at?: number;
      data_access_expires_at?: number;
    };
  }>("debug_token", {
    input_token: userToken,
    access_token: `${appId}|${requireEnv("FACEBOOK_APP_SECRET")}`,
  });
  const data = result.data;
  if (!data?.is_valid || !data.user_id) throw new Error("Meta reported the Facebook login token as invalid.");
  if (data.app_id !== appId) throw new Error("The Facebook login token was issued to a different app.");
  return {
    userId: data.user_id,
    expiresAt: fromUnixSeconds(data.expires_at),
    dataAccessExpiresAt: fromUnixSeconds(data.data_access_expires_at),
  };
}
