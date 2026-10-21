"use client";

/**
 * Moderation: word-list rules per Page. A comment containing any listed word
 * is hidden on the Page before any campaign runs for it. The second half of
 * the page is the log of hidden comments, each with an "unhide" action.
 */

import { useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";

interface Rule {
  id: string;
  instagramAccountId: string;
  name: string;
  keywords: string[];
  wholeWordMatch: boolean;
  isActive: boolean;
  createdAt: string;
  instagramAccount: { username: string };
  _count: { logs: number };
}

interface LogRow {
  id: string;
  commentId: string;
  commenterId: string;
  commenterName: string | null;
  commentText: string;
  matchedKeyword: string | null;
  actionStatus: "PENDING" | "DONE" | "FAILED" | "UNDONE";
  error: string | null;
  createdAt: string;
  rule: { name: string } | null;
  instagramAccount: { username: string };
}

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-accent" : "bg-border-hover"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

function parseWords(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(/[,\n;]+/)
        .map((w) => w.trim())
        .filter(Boolean)
    )
  );
}

export default function ModerationPage() {
  const { t, locale } = useI18n();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [words, setWords] = useState("");
  const [wholeWord, setWholeWord] = useState(false);

  const refresh = useCallback(async () => {
    const params = selectedAccountId ? `?instagramAccountId=${encodeURIComponent(selectedAccountId)}` : "";
    const [rulesRes, logsRes] = await Promise.all([
      fetch(`/api/moderation/rules${params}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/moderation/logs${params}`, { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (rulesRes.success) setRules(rulesRes.data);
    if (logsRes.success) setLogs(logsRes.data);
  }, [selectedAccountId]);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        setAccounts(payload.data.instagramAccounts ?? []);
        setSelectedAccountId((prev) => prev || payload.data.selectedInstagramAccountId || "");
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh()
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function call(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      const payload = await res.json();
      if (!payload.success) throw new Error(payload.error ?? "Request failed");
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createRule(event: React.FormEvent) {
    event.preventDefault();
    const keywords = parseWords(words);
    if (!selectedAccountId || !name.trim() || keywords.length === 0) return;
    const ok = await call("create", "/api/moderation/rules", {
      method: "POST",
      body: JSON.stringify({
        instagramAccountId: selectedAccountId,
        name: name.trim(),
        keywords,
        wholeWordMatch: wholeWord,
      }),
    });
    if (ok) {
      setName("");
      setWords("");
      setWholeWord(false);
    }
  }

  const statusLabel = (log: LogRow) =>
    log.actionStatus === "DONE"
      ? t("Hidden")
      : log.actionStatus === "UNDONE"
        ? t("Unhidden")
        : log.actionStatus === "FAILED"
          ? t("Hide failed")
          : t("Pending");

  if (loading) return <div className="panel rounded p-8 h-64" />;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t("Moderation")}</h1>
          <p className="mt-1 text-sm text-muted">
            {t("Hide comments that contain certain words. Hidden comments get no private reply.")}
          </p>
        </div>
        {accounts.length > 1 && (
          <AccountSelect
            accounts={accounts}
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            includeAll={false}
          />
        )}
      </div>

      {error && (
        <p role="alert" className="rounded border border-error/30 bg-error/5 p-3 text-sm text-error">
          {error}
        </p>
      )}

      {accounts.length === 0 ? (
        <div className="panel rounded p-8 text-center">
          <p className="text-sm text-muted">{t("Connect a Facebook Page before creating rules.")}</p>
          <a href="/settings" className="mt-4 inline-block text-sm text-accent hover:underline">
            {t("Settings")}
          </a>
        </div>
      ) : (
        <form onSubmit={createRule} className="panel rounded p-4 sm:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">{t("New rule")}</h2>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                {t("Rule name")}
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                {t("Words to hide")}
              </span>
              <textarea
                value={words}
                onChange={(e) => setWords(e.target.value)}
                rows={3}
                required
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none resize-y"
              />
              <span className="text-xs text-muted">
                {t(
                  "Separate words with commas or line breaks. Matching ignores accents, repeated letters and swaps like 0 for o, so \"fakee\" and \"f4ke\" count as \"fake\"."
                )}
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-3 text-sm text-foreground">
              <Toggle on={wholeWord} onToggle={() => setWholeWord(!wholeWord)} />
              {t("Whole words only")}
            </label>
            <button
              type="submit"
              disabled={busy !== null || !selectedAccountId || !name.trim() || parseWords(words).length === 0}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy === "create" ? t("Saving…") : t("Save rule")}
            </button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("Rules")}</h2>
        {rules.length === 0 ? (
          <p className="panel rounded p-6 text-sm text-muted">{t("No rules yet. Create the first one above.")}</p>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="panel rounded p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{rule.name}</p>
                  <span className="text-xs text-muted">{rule.instagramAccount.username}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      rule.isActive ? "bg-success/10 text-success" : "bg-border/60 text-muted"
                    }`}
                  >
                    {rule.isActive ? t("Active") : t("Paused")}
                  </span>
                  <span className="text-xs text-muted">{t("{count} hidden", { count: rule._count.logs })}</span>
                  {rule.wholeWordMatch && <span className="text-xs text-muted">· {t("Whole words only")}</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rule.keywords.map((word) => (
                    <span key={word} className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground">
                      {word}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Toggle
                  on={rule.isActive}
                  disabled={busy !== null}
                  onToggle={() =>
                    void call(`toggle:${rule.id}`, `/api/moderation/rules?id=${rule.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ isActive: !rule.isActive }),
                    })
                  }
                />
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    if (confirm(t("Delete this rule?")))
                      void call(`delete:${rule.id}`, `/api/moderation/rules?id=${rule.id}`, { method: "DELETE" });
                  }}
                  className="rounded border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                >
                  {t("Delete")}
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground mb-4">{t("Recently hidden")}</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-muted">{t("No comments hidden yet.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4 font-medium">{t("When")}</th>
                  <th className="py-2 pr-4 font-medium">{t("Author")}</th>
                  <th className="py-2 pr-4 font-medium">{t("Comment")}</th>
                  <th className="py-2 pr-4 font-medium">{t("Rule")}</th>
                  <th className="py-2 pr-4 font-medium">{t("Status")}</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-border align-top">
                    <td className="py-2 pr-4 whitespace-nowrap text-muted">
                      {new Date(log.createdAt).toLocaleString(locale)}
                    </td>
                    <td className="py-2 pr-4 text-foreground">
                      {log.commenterName ?? (log.commenterId.startsWith("comment:") ? "—" : log.commenterId.slice(0, 10))}
                    </td>
                    <td className="py-2 pr-4 text-foreground max-w-md">
                      <span className="line-clamp-2">{log.commentText || t("(no text)")}</span>
                    </td>
                    <td className="py-2 pr-4 text-muted">
                      {log.rule?.name ?? "—"}
                      {log.matchedKeyword && (
                        <span className="block text-xs">{t("Matched: {keyword}", { keyword: log.matchedKeyword })}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          log.actionStatus === "DONE"
                            ? "bg-success/10 text-success"
                            : log.actionStatus === "FAILED"
                              ? "bg-error/10 text-error"
                              : "bg-border/60 text-muted"
                        }`}
                        title={log.error ?? undefined}
                      >
                        {statusLabel(log)}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {log.actionStatus === "DONE" && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void call(`unhide:${log.id}`, "/api/moderation/logs/unhide", {
                              method: "POST",
                              body: JSON.stringify({ logId: log.id }),
                            })
                          }
                          className="rounded border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50"
                        >
                          {busy === `unhide:${log.id}` ? t("Saving…") : t("Unhide")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
