"use client";

import type { StaticMessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type PageOption = {
  id: string;
  name: string;
  tasks: string[];
  eligible: boolean;
  connected: boolean;
  accountId?: string;
  webhookSubscribed?: boolean;
};

type PagesState = {
  configured: boolean;
  tokenKind?: "SYSTEM_USER" | "USER";
  systemUser?: { id: string; name?: string };
  tokenExpiresAt?: string | null;
  dataAccessExpiresAt?: string | null;
  pages: PageOption[];
  orphaned: Array<{ accountId: string; pageId: string; name: string; webhookSubscribed: boolean }>;
};

// Warn this long before Meta stops honouring the person's data access grant.
const EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;

// Statuses the /api/facebook/callback and /api/facebook/login redirects set.
const NOTICES: Record<string, { tone: "success" | "warning" | "error"; title: StaticMessageKey; detail?: StaticMessageKey }> = {
  connected: {
    tone: "success",
    title: "Facebook connected",
    detail: "Select the Pages you want to use and click Connect.",
  },
  no_pages: {
    tone: "warning",
    title: "No Pages were shared",
    detail: "Facebook login worked, but no Page came with it. Connect again and select the Pages in the Facebook window.",
  },
  denied: {
    tone: "warning",
    title: "Facebook connection cancelled",
    detail: "You closed the Facebook window or declined the permissions. Start again and accept them.",
  },
  invalid: {
    tone: "error",
    title: "Facebook connection expired",
    detail: "The login link was missing or older than 10 minutes. Click Connect with Facebook to try again.",
  },
  forbidden: {
    tone: "error",
    title: "Not permitted",
    detail: "Only workspace owners and admins can connect Facebook Pages.",
  },
  misconfigured: { tone: "error", title: "Facebook login is not configured" },
  failed: { tone: "error", title: "Facebook connection failed" },
};

const TONE_CLASSES = {
  success: "border-success/30 bg-success/5 text-success",
  warning: "border-warning/30 bg-warning/5 text-warning",
  error: "border-error/30 bg-error/5 text-error",
} as const;

export function FacebookPagesConnection({ canManage }: { canManage: boolean }) {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const [data, setData] = useState<PagesState | null>(null);
  const [token, setToken] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // When the state was loaded; expiry math runs against it, never against a
  // clock read during render.
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/facebook/pages", { cache: "no-store" });
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    setData(result.data);
    setLoadedAt(Date.now());
  }, []);

  useEffect(() => {
    if (!canManage) return;
    void fetch("/api/facebook/pages", { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (!result.success) throw new Error(result.error);
        setData(result.data);
        setLoadedAt(Date.now());
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load connection.")
      );
  }, [canManage]);

  async function act(
    key: string,
    { path = "", method, body }: { path?: string; method: string; body?: unknown }
  ) {
    setBusy(key);
    setError("");
    try {
      const response = await fetch(`/api/facebook/pages${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      setToken("");
      setReplacing(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not update connection."));
    } finally {
      setBusy(null);
    }
  }

  const isUser = data?.tokenKind === "USER";
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : locale, { dateStyle: "medium" });
  // Page calls stop working at the data access expiry; fall back to the token's.
  const accessEndsAt = isUser ? (data?.dataAccessExpiresAt ?? data?.tokenExpiresAt ?? null) : null;
  const accessMsLeft = accessEndsAt && loadedAt ? new Date(accessEndsAt).getTime() - loadedAt : null;

  const status = searchParams.get("facebook");
  const notice = status ? NOTICES[status] : undefined;
  const missingEnv = (searchParams.get("missing") ?? "").split(",").filter(Boolean);
  const failureReason = searchParams.get("reason");

  const connectButton = (
    <a
      href="/api/facebook/login"
      className={
        data?.configured
          ? "rounded border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-border-hover"
          : "rounded bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
      }
    >
      {data?.configured ? t("Reconnect with Facebook") : t("Connect with Facebook")}
    </a>
  );

  const tokenForm = (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void act("token", { method: "POST", body: { token } });
      }}
    >
      <label className="block text-sm font-medium" htmlFor="facebook-system-user-token">
        {t("System user token")}
      </label>
      <input
        id="facebook-system-user-token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        required
        className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/60 focus:ring-3 focus:ring-accent/15"
      />
      <p className="text-xs leading-5 text-muted">
        {t(
          "Generate the token in Meta Business Suite with the pages_show_list, pages_read_engagement, pages_read_user_content, pages_manage_engagement, pages_manage_metadata and pages_messaging permissions. It is encrypted and never shown again."
        )}
      </p>
      <p className="text-xs leading-5 text-warning">
        {t(
          "Under Standard Access a system user can only message people who have a role on the app. Connect with Facebook to reach everyone who comments."
        )}
      </p>
      <div className="flex gap-3">
        <button
          disabled={busy !== null || !token}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {busy === "token" ? t("Saving…") : t("Save token")}
        </button>
        {replacing && (
          <button
            type="button"
            onClick={() => {
              setReplacing(false);
              setToken("");
            }}
            className="rounded border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
          >
            {t("Cancel")}
          </button>
        )}
      </div>
    </form>
  );

  return (
    <section className="panel rounded-xl p-4 sm:p-6" aria-labelledby="facebook-pages-heading">
      <h2 id="facebook-pages-heading" className="text-base font-semibold">
        {t("Facebook Pages")}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {data?.configured && !isUser
          ? t("Comments and Messenger on your Pages run through a system user from your business portfolio.")
          : t(
              "Log in with the Facebook account that manages your Pages and select them in the Facebook window. Comments and Messenger then run through that account."
            )}
      </p>

      {!canManage ? (
        <p className="mt-4 text-sm text-muted">
          {t("Ask your workspace owner or admin to connect Facebook Pages.")}
        </p>
      ) : (
        <>
          {notice && (
            <div role="status" className={`mt-4 rounded border p-3 text-sm ${TONE_CLASSES[notice.tone]}`}>
              <p className="font-semibold">{t(notice.title)}</p>
              {notice.detail && <p className="mt-1">{t(notice.detail)}</p>}
              {status === "misconfigured" && missingEnv.length > 0 && (
                <p className="mt-1">{t("Set these environment variables: {names}", { names: missingEnv.join(", ") })}</p>
              )}
              {status === "failed" && failureReason && <p className="mt-1 break-words">{failureReason}</p>}
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded border border-error/30 bg-error/5 p-3 text-sm text-error">
              {error === "Could not load connection." ? t("Could not load connection.") : error}
            </p>
          )}

          {/* Always available, so an expired token can be replaced even when
              the saved connection can no longer be loaded. */}
          <div className="mt-5 flex flex-wrap items-center gap-3">{connectButton}</div>

          {data && !data.configured && (
            <div className="mt-4">
              {replacing ? (
                tokenForm
              ) : (
                <button
                  type="button"
                  onClick={() => setReplacing(true)}
                  className="text-xs underline underline-offset-4 text-muted hover:text-foreground"
                >
                  {t("Use a system user token instead")}
                </button>
              )}
            </div>
          )}

          {data?.configured && (
            <div className="mt-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <div className="space-y-1">
                  <p className="text-sm text-foreground">
                    {isUser
                      ? t("Connected with Facebook as {name}", { name: data.systemUser?.name ?? data.systemUser?.id ?? "" })
                      : t("System user: {name}", { name: data.systemUser?.name ?? data.systemUser?.id ?? "" })}
                  </p>
                  {accessEndsAt && accessMsLeft !== null && accessMsLeft > EXPIRY_WARNING_MS && (
                    <p className="text-xs text-muted">
                      {t("Facebook access valid until {date}.", { date: formatDate(accessEndsAt) })}
                    </p>
                  )}
                </div>
                {!isUser && !replacing && (
                  <button
                    type="button"
                    onClick={() => setReplacing(true)}
                    className="text-xs underline underline-offset-4 text-muted hover:text-foreground"
                  >
                    {t("Replace token")}
                  </button>
                )}
              </div>

              {accessEndsAt && accessMsLeft !== null && accessMsLeft <= EXPIRY_WARNING_MS && (
                <p role="alert" className="rounded border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
                  {accessMsLeft <= 0
                    ? t("Facebook access has expired. Reconnect to resume campaigns.")
                    : t("Facebook access expires on {date}. Reconnect before then to keep campaigns running.", {
                        date: formatDate(accessEndsAt),
                      })}
                </p>
              )}

              {!isUser && replacing && tokenForm}

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  {isUser ? t("Pages available to this connection") : t("Pages assigned to the system user")}
                </p>
                {data.pages.length === 0 && (
                  <p className="text-sm text-muted">
                    {isUser
                      ? t("No Pages were shared with this connection. Reconnect with Facebook and select the Pages in the Facebook window.")
                      : t("No Pages are assigned to this system user. Assign the Page in Meta Business Suite and reload.")}
                  </p>
                )}
                {data.pages.map((page) => (
                  <div
                    key={page.id}
                    className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{page.name}</p>
                      <p className="mt-1 text-xs text-muted">
                        {page.connected
                          ? page.webhookSubscribed
                            ? t("Webhook ready")
                            : t("Webhook pending")
                          : page.eligible
                            ? t("Not connected")
                            : t("Missing MESSAGING or MODERATE task on this Page")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {page.connected && page.accountId ? (
                        <>
                          {!page.webhookSubscribed && (
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() =>
                                void act(`resubscribe:${page.id}`, {
                                  path: "/resubscribe",
                                  method: "POST",
                                  body: { accountId: page.accountId },
                                })
                              }
                              className="rounded border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50"
                            >
                              {t("Resubscribe webhook")}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => {
                              if (confirm(t("Disconnect this Page? Campaigns for it will stop sending messages.")))
                                void act(`disconnect:${page.id}`, {
                                  path: "/disconnect",
                                  method: "POST",
                                  body: { accountId: page.accountId },
                                });
                            }}
                            className="rounded border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                          >
                            {busy === `disconnect:${page.id}` ? t("Disconnecting...") : t("Disconnect")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={busy !== null || !page.eligible}
                          onClick={() =>
                            void act(`connect:${page.id}`, {
                              path: "/connect",
                              method: "POST",
                              body: { pageId: page.id },
                            })
                          }
                          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
                        >
                          {busy === `connect:${page.id}` ? t("Connecting…") : t("Connect")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {data.orphaned.map((page) => (
                  <div
                    key={page.accountId}
                    className="flex flex-col gap-3 rounded border border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{page.name}</p>
                      <p className="mt-1 text-xs text-warning">
                        {isUser
                          ? t("This Page is no longer available to this connection.")
                          : t("This Page is no longer assigned to the system user.")}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        if (confirm(t("Disconnect this Page? Campaigns for it will stop sending messages.")))
                          void act(`disconnect:${page.pageId}`, {
                            path: "/disconnect",
                            method: "POST",
                            body: { accountId: page.accountId },
                          });
                      }}
                      className="rounded border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    >
                      {t("Disconnect")}
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  const question = isUser
                    ? t("Remove the Facebook connection? Disconnect its Pages first.")
                    : t("Remove the system user token? Disconnect its Pages first.");
                  if (confirm(question)) void act("remove", { method: "DELETE" });
                }}
                className="text-xs underline underline-offset-4 text-muted hover:text-foreground disabled:opacity-50"
              >
                {isUser ? t("Remove Facebook connection") : t("Remove system user token")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
