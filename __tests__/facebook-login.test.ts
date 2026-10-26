import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeFacebookCode,
  getFacebookLoginUrl,
  getLongLivedUserToken,
  inspectUserToken,
} from "@/lib/facebook/login";
import {
  handleResponse,
  isOutsideMessagingWindowError,
  MetaApiError,
  PermissionError,
} from "@/lib/meta/client";
import { getMissingFacebookLoginEnv } from "@/lib/env";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200, url = "https://graph.facebook.com/v25.0/oauth/access_token") {
  const response = new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function requestedUrl(call = 0) {
  return new URL(String(fetchMock.mock.calls[call][0]));
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("FACEBOOK_APP_ID", "905553522515234");
  vi.stubEnv("FACEBOOK_APP_SECRET", "app-secret");
  vi.stubEnv("FACEBOOK_LOGIN_CONFIG_ID", "1483482843644997");
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Connect with Facebook", () => {
  it("opens the Login for Business dialog with the configuration instead of a scope", () => {
    const url = new URL(getFacebookLoginUrl("https://app.test/api/facebook/callback", "signed-state"));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "905553522515234",
      redirect_uri: "https://app.test/api/facebook/callback",
      state: "signed-state",
      response_type: "code",
      config_id: "1483482843644997",
    });
  });

  it("exchanges the code with the same redirect_uri the dialog used", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: "short", expires_in: 3600 }));
    await expect(exchangeFacebookCode("the-code", "https://app.test/api/facebook/callback")).resolves.toEqual({
      access_token: "short",
      expires_in: 3600,
    });
    const url = requestedUrl();
    expect(url.pathname).toBe("/v25.0/oauth/access_token");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "905553522515234",
      client_secret: "app-secret",
      redirect_uri: "https://app.test/api/facebook/callback",
      code: "the-code",
    });
  });

  it("trades the short-lived token for a long-lived one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: "long", expires_in: 5183944 }));
    await expect(getLongLivedUserToken("short")).resolves.toMatchObject({ access_token: "long" });
    expect(Object.fromEntries(requestedUrl().searchParams)).toEqual({
      grant_type: "fb_exchange_token",
      client_id: "905553522515234",
      client_secret: "app-secret",
      fb_exchange_token: "short",
    });
  });

  it("keeps the code and the secret out of error messages", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "Invalid verification code format.", type: "OAuthException", code: 100 } }, 400)
    );
    const error = await exchangeFacebookCode("the-code", "https://app.test/cb").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaApiError);
    expect(String((error as Error).message)).not.toMatch(/the-code|app-secret/);
  });

  it("reads expiry dates from debug_token and treats 0 as no expiry", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          app_id: "905553522515234",
          is_valid: true,
          user_id: "u1",
          expires_at: 0,
          data_access_expires_at: 1800000000,
        },
      })
    );
    await expect(inspectUserToken("long")).resolves.toEqual({
      userId: "u1",
      expiresAt: null,
      dataAccessExpiresAt: new Date(1800000000 * 1000),
    });
    const url = requestedUrl();
    expect(url.pathname).toBe("/v25.0/debug_token");
    expect(url.searchParams.get("access_token")).toBe("905553522515234|app-secret");
  });

  it("refuses a token issued to another app or reported invalid", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { app_id: "999", is_valid: true, user_id: "u1", expires_at: 1 } })
    );
    await expect(inspectUserToken("long")).rejects.toThrow("different app");
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { app_id: "905553522515234", is_valid: false } }));
    await expect(inspectUserToken("long")).rejects.toThrow("invalid");
  });

  it("lists every variable the login needs that is missing", () => {
    vi.stubEnv("FACEBOOK_LOGIN_CONFIG_ID", "");
    vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
    vi.stubEnv("NEXTAUTH_SECRET", "secret");
    expect(getMissingFacebookLoginEnv()).toEqual(["FACEBOOK_LOGIN_CONFIG_ID"]);
  });
});

describe("closed messaging window", () => {
  it("is recognized by subcode, whatever language Meta answers in", async () => {
    const response = jsonResponse(
      {
        error: {
          message: "(#10) Essa mensagem foi enviada fora do espaço de tempo permitido.",
          type: "OAuthException",
          code: 10,
          error_subcode: 2018278,
        },
      },
      400,
      "https://graph.facebook.com/v25.0/123/messages"
    );
    const error = await handleResponse(response).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermissionError);
    expect((error as PermissionError).subcode).toBe(2018278);
    expect(isOutsideMessagingWindowError(error)).toBe(true);
  });

  it("is not confused with a Standard Access refusal, which is also code 10", async () => {
    const response = jsonResponse(
      {
        error: {
          message:
            "Cannot message users who are not admins, developers or testers of the app until pages_messaging permission is reviewed and the app is live.",
          type: "OAuthException",
          code: 10,
        },
      },
      400,
      "https://graph.facebook.com/v25.0/123/messages"
    );
    const error = await handleResponse(response).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermissionError);
    expect(isOutsideMessagingWindowError(error)).toBe(false);
  });

  it("still recognizes the English message without a subcode", () => {
    expect(isOutsideMessagingWindowError(new MetaApiError(10, undefined, undefined, "This message is sent outside of allowed window."))).toBe(true);
    expect(isOutsideMessagingWindowError(new Error("outside of allowed window"))).toBe(false);
  });
});
