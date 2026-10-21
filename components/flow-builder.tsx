"use client";

/**
 * Flow editor: trigger settings plus an ordered list of steps, each with a
 * delay, a message and up to three CTA buttons (title + URL). A timeline on
 * the side shows when each step lands relative to the person's last message
 * and flags the ones that fall past the 24h window.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { useI18n } from "@/lib/i18n/provider";
import { cumulativeDelays, stepsBeyondWindow } from "@/lib/flows/window";

type ButtonDraft = { id?: string; title: string; url: string };
type StepDraft = { id?: string; delayValue: number; delayUnit: "minutes" | "hours"; message: string; buttons: ButtonDraft[] };

interface FlowBuilderProps {
  mode: "new" | "edit";
  flowId?: string;
}

const DEFAULT_STOP_WORDS = "parar, sair, stop, cancelar";

function toMinutes(step: StepDraft) {
  const value = Math.max(0, Math.floor(Number(step.delayValue) || 0));
  return step.delayUnit === "hours" ? value * 60 : value;
}

function fromMinutes(minutes: number): Pick<StepDraft, "delayValue" | "delayUnit"> {
  if (minutes > 0 && minutes % 60 === 0) return { delayValue: minutes / 60, delayUnit: "hours" };
  return { delayValue: minutes, delayUnit: "minutes" };
}

function parseWords(raw: string) {
  return Array.from(new Set(raw.split(/[,\n;]+/).map((w) => w.trim()).filter(Boolean)));
}

function formatOffset(minutes: number, t: (k: "{count} min" | "{count} h", v: { count: number }) => string) {
  if (minutes < 60) return t("{count} min", { count: minutes });
  const hours = Math.round((minutes / 60) * 10) / 10;
  return t("{count} h", { count: hours });
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-border-hover"}`}
    >
      <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${on ? "left-6" : "left-1"}`} />
    </button>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none";
const labelClass = "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted";

export default function FlowBuilder({ mode, flowId }: FlowBuilderProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [triggerAnyMessage, setTriggerAnyMessage] = useState(true);
  const [triggerKeywords, setTriggerKeywords] = useState("");
  const [wholeWordMatch, setWholeWordMatch] = useState(false);
  const [stopKeywords, setStopKeywords] = useState(DEFAULT_STOP_WORDS);
  const [resumeOnReply, setResumeOnReply] = useState(true);
  const [steps, setSteps] = useState<StepDraft[]>([
    { delayValue: 0, delayUnit: "minutes", message: "", buttons: [] },
  ]);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        setAccounts(payload.data.instagramAccounts ?? []);
        setAccountId((prev) => prev || payload.data.selectedInstagramAccountId || "");
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !flowId) return;
    fetch(`/api/flows/${flowId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) throw new Error(payload.error);
        const f = payload.data;
        setAccountId(f.instagramAccountId);
        setName(f.name);
        setIsActive(f.isActive);
        setTriggerAnyMessage(f.triggerAnyMessage);
        setTriggerKeywords(f.triggerKeywords.join(", "));
        setWholeWordMatch(f.wholeWordMatch);
        setStopKeywords(f.stopKeywords.join(", "));
        setResumeOnReply(f.resumeOnReply);
        setSteps(
          f.steps.map((s: { id: string; delayMinutes: number; message: string; buttons: ButtonDraft[] }) => ({
            id: s.id,
            ...fromMinutes(s.delayMinutes),
            message: s.message,
            buttons: s.buttons.map((b) => ({ id: b.id, title: b.title, url: b.url })),
          }))
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load flow"))
      .finally(() => setLoading(false));
  }, [mode, flowId]);

  const minutes = useMemo(() => steps.map((s) => ({ delayMinutes: toMinutes(s) })), [steps]);
  const offsets = useMemo(() => cumulativeDelays(minutes), [minutes]);
  const beyond = useMemo(() => new Set(stepsBeyondWindow(minutes)), [minutes]);

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function updateButton(stepIndex: number, buttonIndex: number, patch: Partial<ButtonDraft>) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? { ...s, buttons: s.buttons.map((b, j) => (j === buttonIndex ? { ...b, ...patch } : b)) }
          : s
      )
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!accountId) return setError(t("Connect a Facebook Page before creating flows."));
    if (!name.trim()) return setError(t("Give the flow a name."));
    if (steps.some((s) => !s.message.trim())) return setError(t("Every step needs a message."));
    if (!triggerAnyMessage && parseWords(triggerKeywords).length === 0)
      return setError(t("Add trigger words or trigger on any message."));

    const body = {
      instagramAccountId: accountId,
      name: name.trim(),
      isActive,
      triggerAnyMessage,
      triggerKeywords: triggerAnyMessage ? [] : parseWords(triggerKeywords),
      wholeWordMatch,
      stopKeywords: parseWords(stopKeywords),
      resumeOnReply,
      steps: steps.map((s) => ({
        ...(s.id ? { id: s.id } : {}),
        delayMinutes: toMinutes(s),
        message: s.message.trim(),
        buttons: s.buttons
          .filter((b) => b.title.trim() && b.url.trim())
          .map((b) => ({ ...(b.id ? { id: b.id } : {}), title: b.title.trim(), url: b.url.trim() })),
      })),
    };

    setSaving(true);
    try {
      const res = await fetch(mode === "edit" ? `/api/flows/${flowId}` : "/api/flows", {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!payload.success) throw new Error(payload.error ?? "Failed to save flow");
      router.push(`/flows/${payload.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save flow");
      setSaving(false);
    }
  }

  if (loading) return <div className="panel rounded p-8 h-64" />;

  return (
    <form onSubmit={save} className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-6">
        {error && (
          <p role="alert" className="rounded border border-error/30 bg-error/5 p-3 text-sm text-error">
            {error}
          </p>
        )}

        <section className="panel rounded p-4 sm:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">{t("Flow")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              <span className={labelClass}>{t("Flow name")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required className={inputClass} />
            </label>
            {mode === "new" ? (
              <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} includeAll={false} />
            ) : (
              <label className="flex flex-col gap-2 text-sm">
                <span className={labelClass}>{t("Instagram account")}</span>
                <span className="py-2 text-sm text-foreground">
                  {accounts.find((a) => a.id === accountId)?.username ?? "—"}
                </span>
              </label>
            )}
          </div>
          <label className="flex items-center gap-3 text-sm text-foreground">
            <Toggle on={isActive} onToggle={() => setIsActive(!isActive)} />
            {t("Active")}
          </label>
        </section>

        <section className="panel rounded p-4 sm:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">{t("When someone sends a DM")}</h2>
          <label className="flex items-center gap-3 text-sm text-foreground">
            <Toggle on={triggerAnyMessage} onToggle={() => setTriggerAnyMessage(!triggerAnyMessage)} />
            {t("Start on any message")}
          </label>
          {!triggerAnyMessage && (
            <div className="space-y-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className={labelClass}>{t("Trigger words")}</span>
                <textarea value={triggerKeywords} onChange={(e) => setTriggerKeywords(e.target.value)} rows={2} className={inputClass} />
              </label>
              <label className="flex items-center gap-3 text-sm text-foreground">
                <Toggle on={wholeWordMatch} onToggle={() => setWholeWordMatch(!wholeWordMatch)} />
                {t("Whole words only")}
              </label>
            </div>
          )}
          <p className="text-xs text-muted">
            {t("People who received this flow's comment-to-DM reply enter it when they answer, whatever they write.")}
          </p>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{t("Messages")}</h2>
            <span className="text-xs text-muted">{t("{count} steps", { count: steps.length })}</span>
          </div>
          {steps.map((step, index) => (
            <div key={step.id ?? `new-${index}`} className="panel rounded p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                    {index + 1}
                  </span>
                  {index === 0 ? (
                    <span className="text-xs text-muted">{t("Sent when the person writes")}</span>
                  ) : (
                    <span className="text-xs text-muted">{t("After the previous message")}</span>
                  )}
                  {beyond.has(index) && (
                    <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                      {t("Past the 24h window")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40">↑</button>
                  <button type="button" onClick={() => moveStep(index, 1)} disabled={index === steps.length - 1} className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40">↓</button>
                  <button
                    type="button"
                    onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
                    disabled={steps.length === 1}
                    className="rounded border border-error/20 px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-40"
                  >
                    {t("Remove")}
                  </button>
                </div>
              </div>

              {index > 0 && (
                <div className="flex items-center gap-2">
                  <span className={labelClass}>{t("Delay")}</span>
                  <input
                    type="number"
                    min={0}
                    value={step.delayValue}
                    onChange={(e) => updateStep(index, { delayValue: Number(e.target.value) })}
                    className="w-24 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                  />
                  <select
                    value={step.delayUnit}
                    onChange={(e) => updateStep(index, { delayUnit: e.target.value as StepDraft["delayUnit"] })}
                    className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none"
                  >
                    <option value="minutes">{t("minutes")}</option>
                    <option value="hours">{t("hours")}</option>
                  </select>
                </div>
              )}

              <textarea
                value={step.message}
                onChange={(e) => updateStep(index, { message: e.target.value })}
                rows={3}
                maxLength={1000}
                placeholder={t("Message text. {username} becomes the person's name.", { username: "{username}" })}
                className={`${inputClass} resize-y`}
              />

              <div className="space-y-2">
                {step.buttons.map((button, bIndex) => (
                  <div key={button.id ?? `b-${bIndex}`} className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                    <input
                      value={button.title}
                      onChange={(e) => updateButton(index, bIndex, { title: e.target.value })}
                      maxLength={20}
                      placeholder={t("Button text")}
                      className={inputClass}
                    />
                    <input
                      value={button.url}
                      onChange={(e) => updateButton(index, bIndex, { url: e.target.value })}
                      type="url"
                      placeholder="https://"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => updateStep(index, { buttons: step.buttons.filter((_, j) => j !== bIndex) })}
                      className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {step.buttons.length < 3 && (
                  <button
                    type="button"
                    onClick={() => updateStep(index, { buttons: [...step.buttons, { title: "", url: "" }] })}
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    {t("+ Add a button with a link")}
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setSteps((prev) => [...prev, { delayValue: 10, delayUnit: "minutes", message: "", buttons: [] }])
            }
            disabled={steps.length >= 30}
            className="w-full rounded-lg border border-dashed border-border py-3 text-sm font-medium text-muted hover:border-border-hover hover:text-foreground disabled:opacity-50"
          >
            {t("+ Add a message")}
          </button>
        </section>

        <section className="panel rounded p-4 sm:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">{t("Rules")}</h2>
          <label className="flex flex-col gap-2 text-sm">
            <span className={labelClass}>{t("Stop words")}</span>
            <input value={stopKeywords} onChange={(e) => setStopKeywords(e.target.value)} className={inputClass} />
            <span className="text-xs text-muted">{t("A message with one of these words ends every flow for that person and sends a short confirmation.")}</span>
          </label>
          <label className="flex items-center gap-3 text-sm text-foreground">
            <Toggle on={resumeOnReply} onToggle={() => setResumeOnReply(!resumeOnReply)} />
            <span>
              {t("Resume when the person writes again")}
              <span className="block text-xs text-muted">{t("Steps skipped because the 24h window closed go out on their next message.")}</span>
            </span>
          </label>
        </section>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => router.back()} className="rounded border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground">
            {t("Cancel")}
          </button>
          <button type="submit" disabled={saving} className="rounded bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
            {saving ? t("Saving…") : mode === "edit" ? t("Save changes") : t("Create flow")}
          </button>
        </div>
      </div>

      <aside className="lg:sticky lg:top-6 h-fit">
        <div className="panel rounded p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{t("Timeline")}</h3>
          <p className="text-xs text-muted">{t("Counted from the person's last message.")}</p>
          <ol className="space-y-2">
            {steps.map((step, index) => (
              <li key={step.id ?? `tl-${index}`} className="flex items-start gap-3 text-sm">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${beyond.has(index) ? "bg-warning" : "bg-accent"}`} />
                <div className="min-w-0">
                  <p className="text-foreground">{formatOffset(offsets[index] ?? 0, t)}</p>
                  <p className="truncate text-xs text-muted">{step.message || t("(no text)")}</p>
                </div>
              </li>
            ))}
            <li className="flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 border-t border-dashed border-border" />
              {t("24h window")}
              <span className="h-px flex-1 border-t border-dashed border-border" />
            </li>
          </ol>
          {beyond.size > 0 && (
            <p className="rounded border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
              {t("Steps past the 24h mark are only sent if the person interacts again.")}
            </p>
          )}
        </div>
      </aside>
    </form>
  );
}
