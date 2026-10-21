/**
 * Per-step and per-flow numbers, computed from FlowSendLog and FlowClick rows.
 * Pure functions: the routes fetch, this file counts.
 */

export type SendStatus =
  | "CLAIMED"
  | "SENT"
  | "FAILED"
  | "SKIPPED_WINDOW"
  | "SKIPPED_TAKEOVER"
  | "SKIPPED_OPTOUT";

export interface SendRow {
  stepId: string;
  status: SendStatus;
  readAt: Date | null;
}

export interface ClickRow {
  id: string;
  buttonId: string;
  recipientHash: string | null;
  ipHash: string | null;
}

export interface ButtonMetrics {
  buttonId: string;
  clicks: number;
}

export interface StepMetrics {
  stepId: string;
  sent: number;
  read: number;
  failed: number;
  skippedWindow: number;
  skippedOther: number;
  clicks: number;
  /** read / sent, 0..1 */
  openRate: number;
  /** clicks / sent, 0..1 */
  ctr: number;
  buttons: ButtonMetrics[];
}

export interface FlowTotals {
  sent: number;
  read: number;
  clicks: number;
  openRate: number;
  ctr: number;
}

function rate(part: number, whole: number) {
  return whole > 0 ? part / whole : 0;
}

/**
 * Clicks count once per person: by the `?r=` token when the link was sent in
 * a DM, else by IP, else each row on its own.
 */
export function countUniqueClicks(rows: ClickRow[]): number {
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.recipientHash ? `r:${row.recipientHash}` : row.ipHash ? `ip:${row.ipHash}` : `id:${row.id}`);
  }
  return seen.size;
}

export function summarizeSteps(
  steps: { id: string; buttons: { id: string }[] }[],
  sends: SendRow[],
  clicks: ClickRow[]
): StepMetrics[] {
  const sendsByStep = new Map<string, SendRow[]>();
  for (const row of sends) {
    const list = sendsByStep.get(row.stepId) ?? [];
    list.push(row);
    sendsByStep.set(row.stepId, list);
  }
  const clicksByButton = new Map<string, ClickRow[]>();
  for (const row of clicks) {
    const list = clicksByButton.get(row.buttonId) ?? [];
    list.push(row);
    clicksByButton.set(row.buttonId, list);
  }

  return steps.map((step) => {
    const rows = sendsByStep.get(step.id) ?? [];
    const sent = rows.filter((r) => r.status === "SENT").length;
    const read = rows.filter((r) => r.status === "SENT" && r.readAt).length;
    const buttons = step.buttons.map((b) => ({
      buttonId: b.id,
      clicks: countUniqueClicks(clicksByButton.get(b.id) ?? []),
    }));
    // A person who tapped any button of the step counts once for the step.
    const stepClicks = countUniqueClicks(step.buttons.flatMap((b) => clicksByButton.get(b.id) ?? []));
    return {
      stepId: step.id,
      sent,
      read,
      failed: rows.filter((r) => r.status === "FAILED").length,
      skippedWindow: rows.filter((r) => r.status === "SKIPPED_WINDOW").length,
      skippedOther: rows.filter((r) => r.status === "SKIPPED_TAKEOVER" || r.status === "SKIPPED_OPTOUT").length,
      clicks: stepClicks,
      openRate: rate(read, sent),
      ctr: rate(stepClicks, sent),
      buttons,
    };
  });
}

export function totalsOf(steps: StepMetrics[]): FlowTotals {
  const sent = steps.reduce((n, s) => n + s.sent, 0);
  const read = steps.reduce((n, s) => n + s.read, 0);
  const clicks = steps.reduce((n, s) => n + s.clicks, 0);
  return { sent, read, clicks, openRate: rate(read, sent), ctr: rate(clicks, sent) };
}
