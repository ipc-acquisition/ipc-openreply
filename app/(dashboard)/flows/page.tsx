"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";

interface FlowRow {
  id: string;
  name: string;
  isActive: boolean;
  instagramAccount: { username: string };
  triggerAnyMessage: boolean;
  triggerKeywords: string[];
  stepCount: number;
  stats: {
    active: number;
    paused: number;
    completed: number;
    stopped: number;
    sent: number;
    read: number;
    clicks: number;
    openRate: number;
    ctr: number;
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function FlowsPage() {
  const { t } = useI18n();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchFlows = useCallback(async () => {
    const params = selectedAccountId !== "all" ? `?instagramAccountId=${encodeURIComponent(selectedAccountId)}` : "";
    const res = await fetch(`/api/flows${params}`, { cache: "no-store" });
    const payload = await res.json();
    if (payload.success) setFlows(payload.data);
  }, [selectedAccountId]);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchFlows().catch(console.error).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchFlows]);

  async function toggleActive(flow: FlowRow) {
    setBusyId(flow.id);
    try {
      await fetch(`/api/flows/${flow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !flow.isActive }),
      });
      await fetchFlows();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="panel rounded p-8 h-64" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t("Flows")}</h1>
          <p className="mt-1 text-sm text-muted">
            {t("Message sequences sent after someone writes to the Page, inside the 24h window.")}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {accounts.length > 1 && (
            <AccountSelect accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} />
          )}
          <Link href="/flows/new" className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
            {t("New flow")}
          </Link>
        </div>
      </div>

      {flows.length === 0 ? (
        <div className="panel rounded p-10 text-center">
          <p className="text-sm text-muted">{t("No flows yet. Create the first one to welcome people who message the Page.")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {flows.map((flow) => (
            <div key={flow.id} className="panel rounded p-4 sm:p-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/flows/${flow.id}`} className="text-sm font-semibold text-foreground hover:underline">
                    {flow.name}
                  </Link>
                  <span className="text-xs text-muted">{flow.instagramAccount.username}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${flow.isActive ? "bg-success/10 text-success" : "bg-border/60 text-muted"}`}>
                    {flow.isActive ? t("Active") : t("Paused")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {flow.triggerAnyMessage ? t("Any message") : flow.triggerKeywords.join(", ")} · {t("{count} steps", { count: flow.stepCount })}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center sm:grid-cols-6">
                <Stat label={t("Active")} value={String(flow.stats.active)} />
                <Stat label={t("Completed")} value={String(flow.stats.completed)} />
                <Stat label={t("Sent")} value={String(flow.stats.sent)} />
                <Stat label={t("Open rate")} value={pct(flow.stats.openRate)} />
                <Stat label={t("Clicks")} value={String(flow.stats.clicks)} />
                <Stat label={t("CTR")} value={pct(flow.stats.ctr)} />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === flow.id}
                  onClick={() => void toggleActive(flow)}
                  className="rounded border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-border-hover hover:text-foreground disabled:opacity-50"
                >
                  {flow.isActive ? t("Pause") : t("Activate")}
                </button>
                <Link href={`/flows/${flow.id}/edit`} className="rounded border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-border-hover hover:text-foreground">
                  {t("Edit")}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}
