import { matchKeywords } from "@/lib/utils/keyword-matcher";

/**
 * Pure rules for Messenger flows: the 24-hour window, the trigger and the
 * stop words. No I/O here so they can be unit-tested and reused by the UI
 * (timeline preview) and the API (validation).
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000;
// Do not send right up to the edge: clocks differ and Meta counts from its
// own receipt time. A step that lands inside this margin is skipped.
export const WINDOW_SAFETY_MARGIN_MS = 15 * 60 * 1000;

export function windowEndsAt(lastInboundAt: Date): Date {
  return new Date(lastInboundAt.getTime() + WINDOW_MS);
}

/** True while a message can still be sent inside the person's 24h window. */
export function isWindowOpen(lastInboundAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() < windowEndsAt(lastInboundAt).getTime() - WINDOW_SAFETY_MARGIN_MS;
}

export function matchesStopKeyword(text: string, stopKeywords: string[]): boolean {
  if (!text || stopKeywords.length === 0) return false;
  // Whole words only: "parar" should not fire on "preparar".
  return matchKeywords(text, stopKeywords, true).matched;
}

export function flowMatchesMessage(
  flow: { triggerAnyMessage: boolean; triggerKeywords: string[]; wholeWordMatch: boolean },
  text: string
): boolean {
  if (flow.triggerAnyMessage) return true;
  if (flow.triggerKeywords.length === 0) return false;
  return matchKeywords(text, flow.triggerKeywords, flow.wholeWordMatch).matched;
}

/** Cumulative minutes from enrollment to each step, in position order. */
export function cumulativeDelays(steps: { delayMinutes: number }[]): number[] {
  let total = 0;
  return steps.map((step) => {
    total += Math.max(0, step.delayMinutes);
    return total;
  });
}

/**
 * Positions (0-based) of steps whose cumulative delay falls past the point
 * where the window may already have closed — they only go out if the person
 * writes again. Used by the editor's warning.
 */
export function stepsBeyondWindow(steps: { delayMinutes: number }[]): number[] {
  const limitMinutes = (WINDOW_MS - WINDOW_SAFETY_MARGIN_MS) / 60_000;
  return cumulativeDelays(steps)
    .map((minutes, index) => (minutes > limitMinutes ? index : -1))
    .filter((index) => index >= 0);
}
