"use client";

/**
 * Flow details: per-message numbers (sent, opened, clicks, CTR, per button)
 * plus enrollment totals, in the style of a ManyChat sequence report.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { cumulativeDelays } from "@/lib/flows/window";

interface FlowDetail {
  id: string;
  name: string;
  isActive: boolean;
  triggerAnyMessage: boolean;
  triggerKeywords: string[];
  stopKeywords: string[];
  resumeOnReply: boolean;
  instagramAccount: { username: string };
  steps: Array<{
    id: string;
    position: number;
    delayMinutes: number;
    message: string;
    buttons: Array<{ id: string; title: string; url: string }>;
  }>;
  metrics: {
    steps: Array<{
      stepId: string;
      sent: number;
      read: number;
      failed: number;
      skippedWindow: number;
      skippedOther: number;
      clicks: number;
      openRate: number;
      ctr: number;
      buttons: Array<{ buttonId: string; clicks: number }>;
    }>;
    totals: { sent: number; read: number; clicks: number; openRate: number; ctr: number };
    enrollments: Record<string, number>;
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function FlowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, label } = useI18n();
  const router = useRouter();
  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/flows/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) throw new Error(payload.error);
        setFlow(payload.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load flow"));
  }, [id]);

  async function remove() {
    if (!flow || !confirm(t("Delete this flow? People currently in it will stop receiving its messages."))) return;
    setBusy(true);
    await fetch(`/api/flows/${flow.id}`, { method: "DELETE" });
    router.push("/flows");
  }

  if (error) return <p className="panel rounded p-6 text-sm text-error">{error}</p>;
  if (!flow) return <div className="panel rounded p-8 h-64" />;

  const offsets = cumulativeDelays(flow.steps);
  const metricsByStep = new Map(flow.metrics.steps.map((m) => [m.stepId, m]));
  const e = flow.metrics.enrollments;
  const paused = (e.PAUSED_WINDOW ?? 0) + (e.PAUSED_TAKEOVER ?? 0);
  const stopped = (e.STOPPED_OPTOUT ?? 0) + (e.STOPPED_MANUAL ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/flows" className="text-xs text-muted hover:text-foreground">← {t("Flows")}</Link>
          <h1 className="mt-1 text-lg font-semibold text-foreground">{flow.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {flow.instagramAccount.username} · {flow.triggerAnyMessage ? t("Any message") : flow.triggerKeywords.join(", ")} ·{" "}
            <span className={flow.isActive ? "text-success" : ""}>{flow.isActive ? t("Active") : t("Paused")}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/flows/${flow.id}/edit`} className="rounded border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-border-hover hover:text-foreground">
            {t("Edit")}
          </Link>
          <button type="button" disabled={busy} onClick={() => void remove()} className="rounded border border-error/20 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50">
            {t("Delete")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Tile label={t("Active")} value={String(e.ACTIVE ?? 0)} />
        <Tile label={t("Paused")} value={String(paused)} />
        <Tile label={t("Completed")} value={String(e.COMPLETED ?? 0)} />
        <Tile label={t("Stopped")} value={String(stopped)} />
        <Tile label={t("Sent")} value={String(flow.metrics.totals.sent)} />
        <Tile label={t("Open rate")} value={pct(flow.metrics.totals.openRate)} />
        <Tile label={t("Clicks")} value={String(flow.metrics.totals.clicks)} />
        <Tile label={t("CTR")} value={pct(flow.metrics.totals.ctr)} />
      </div>

      <div className="panel rounded p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground mb-4">{t("Messages")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-4 font-medium">#</th>
                <th className="py-2 pr-4 font-medium">{t("Message")}</th>
                <th className="py-2 pr-4 font-medium">{t("When")}</th>
                <th className="py-2 pr-4 font-medium text-right">{t("Sent")}</th>
                <th className="py-2 pr-4 font-medium text-right">{t("Opened")}</th>
                <th className="py-2 pr-4 font-medium text-right">{t("Clicks")}</th>
                <th className="py-2 pr-4 font-medium text-right">{t("CTR")}</th>
                <th className="py-2 font-medium text-right">{t("Skipped")}</th>
              </tr>
            </thead>
            <tbody>
              {flow.steps.map((step, index) => {
                const m = metricsByStep.get(step.id);
                return (
                  <tr key={step.id} className="border-t border-border align-top">
                    <td className="py-3 pr-4 text-muted">{index + 1}</td>
                    <td className="py-3 pr-4 max-w-md">
                      <p className="line-clamp-2 text-foreground">{step.message}</p>
                      {step.buttons.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {step.buttons.map((b) => (
                            <li key={b.id} className="text-xs text-muted">
                              <span className="rounded border border-border px-1.5 py-0.5 text-foreground">{b.title}</span>{" "}
                              → {b.url}{" "}
                              <span className="text-muted">
                                · {t("{count} clicks", { count: m?.buttons.find((x) => x.buttonId === b.id)?.clicks ?? 0 })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap text-muted">
                      {offsets[index] < 60 ? t("{count} min", { count: offsets[index] }) : t("{count} h", { count: Math.round((offsets[index] / 60) * 10) / 10 })}
                    </td>
                    <td className="py-3 pr-4 text-right text-foreground">{m?.sent ?? 0}</td>
                    <td className="py-3 pr-4 text-right text-foreground">
                      {m?.read ?? 0} <span className="text-xs text-muted">({pct(m?.openRate ?? 0)})</span>
                    </td>
                    <td className="py-3 pr-4 text-right text-foreground">{m?.clicks ?? 0}</td>
                    <td className="py-3 pr-4 text-right text-foreground">{pct(m?.ctr ?? 0)}</td>
                    <td className="py-3 text-right text-muted" title={`${label("FAILED")}: ${m?.failed ?? 0}`}>
                      {(m?.skippedWindow ?? 0) + (m?.skippedOther ?? 0)}
                      {(m?.failed ?? 0) > 0 && <span className="ml-1 text-xs text-error">+{m?.failed}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">
          {t("Opened uses Messenger read receipts. Skipped counts messages not sent because the 24h window had closed or the person opted out.")}
        </p>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel rounded p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
