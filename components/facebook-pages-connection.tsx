"use client";

import { useI18n } from "@/lib/i18n/provider";
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
  systemUser?: { id: string; name?: string };
  pages: PageOption[];
  orphaned: Array<{ accountId: string; pageId: string; name: string; webhookSubscribed: boolean }>;
};

export function FacebookPagesConnection({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<PagesState | null>(null);
  const [token, setToken] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/facebook/pages", { cache: "no-store" });
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    setData(result.data);
  }, []);

  useEffect(() => {
    if (!canManage) return;
    void fetch("/api/facebook/pages", { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (!result.success) throw new Error(result.error);
        setData(result.data);
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
        className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
      />
      <p className="text-xs leading-5 text-muted">
        {t(
          "Generate the token in Meta Business Suite with the pages_show_list, pages_read_engagement, pages_read_user_content, pages_manage_engagement, pages_manage_metadata and pages_messaging permissions. It is encrypted and never shown again."
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
        {t("Comments and Messenger on your Pages run through a system user from your business portfolio.")}
      </p>

      {!canManage ? (
        <p className="mt-4 text-sm text-muted">
          {t("Ask your workspace owner or admin to connect Facebook Pages.")}
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="mt-4 rounded border border-error/30 bg-error/5 p-3 text-sm text-error">
              {error === "Could not load connection." ? t("Could not load connection.") : error}
            </p>
          )}

          {data && !data.configured && <div className="mt-5">{tokenForm}</div>}

          {data?.configured && (
            <div className="mt-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <p className="text-sm text-foreground">
                  {t("System user: {name}", { name: data.systemUser?.name ?? data.systemUser?.id ?? "" })}
                </p>
                {!replacing && (
                  <button
                    type="button"
                    onClick={() => setReplacing(true)}
                    className="text-xs underline underline-offset-4 text-muted hover:text-foreground"
                  >
                    {t("Replace token")}
                  </button>
                )}
              </div>

              {replacing && tokenForm}

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  {t("Pages assigned to the system user")}
                </p>
                {data.pages.length === 0 && (
                  <p className="text-sm text-muted">
                    {t("No Pages are assigned to this system user. Assign the Page in Meta Business Suite and reload.")}
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
                        {t("This Page is no longer assigned to the system user.")}
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
                  if (confirm(t("Remove the system user token? Disconnect its Pages first.")))
                    void act("remove", { method: "DELETE" });
                }}
                className="text-xs underline underline-offset-4 text-muted hover:text-foreground disabled:opacity-50"
              >
                {t("Remove system user token")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
