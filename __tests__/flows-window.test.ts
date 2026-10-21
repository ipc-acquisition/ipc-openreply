import { describe, expect, it } from "vitest";
import {
  cumulativeDelays,
  flowMatchesMessage,
  isWindowOpen,
  matchesStopKeyword,
  stepsBeyondWindow,
  windowEndsAt,
} from "@/lib/flows/window";

const t0 = new Date("2026-10-21T12:00:00Z");
const plus = (ms: number) => new Date(t0.getTime() + ms);
const H = 60 * 60 * 1000;

describe("24h window", () => {
  it("ends 24h after the last inbound message", () => {
    expect(windowEndsAt(t0)).toEqual(plus(24 * H));
  });

  it("is open inside the window and closed in the last 15 minutes", () => {
    expect(isWindowOpen(t0, plus(1 * H))).toBe(true);
    expect(isWindowOpen(t0, plus(23 * H + 44 * 60_000))).toBe(true);
    expect(isWindowOpen(t0, plus(23 * H + 46 * 60_000))).toBe(false);
    expect(isWindowOpen(t0, plus(30 * H))).toBe(false);
  });

  it("is closed when the person never wrote", () => {
    expect(isWindowOpen(null, t0)).toBe(false);
    expect(isWindowOpen(undefined, t0)).toBe(false);
  });
});

describe("stop keywords", () => {
  const stop = ["parar", "sair", "stop", "cancelar"];
  it("matches whole words, with accents and case folded", () => {
    expect(matchesStopKeyword("PARAR", stop)).toBe(true);
    expect(matchesStopKeyword("quero sair daqui", stop)).toBe(true);
    expect(matchesStopKeyword("Stop!", stop)).toBe(true);
  });
  it("does not fire inside other words", () => {
    expect(matchesStopKeyword("vou preparar o almoço", stop)).toBe(false);
    expect(matchesStopKeyword("", stop)).toBe(false);
  });
});

describe("flow trigger", () => {
  it("any-message flows match everything", () => {
    expect(flowMatchesMessage({ triggerAnyMessage: true, triggerKeywords: [], wholeWordMatch: false }, "oi")).toBe(true);
  });
  it("keyword flows need a hit, substring unless whole-word", () => {
    const flow = { triggerAnyMessage: false, triggerKeywords: ["ebook"], wholeWordMatch: false };
    expect(flowMatchesMessage(flow, "quero o ebook grátis")).toBe(true);
    expect(flowMatchesMessage(flow, "quero o EBOOKS")).toBe(true);
    expect(flowMatchesMessage({ ...flow, wholeWordMatch: true }, "quero o EBOOKS")).toBe(false);
    expect(flowMatchesMessage(flow, "oi")).toBe(false);
    expect(flowMatchesMessage({ ...flow, triggerKeywords: [] }, "oi")).toBe(false);
  });
});

describe("timeline", () => {
  const steps = [{ delayMinutes: 0 }, { delayMinutes: 10 }, { delayMinutes: 120 }, { delayMinutes: 1200 }];
  it("accumulates delays in order", () => {
    expect(cumulativeDelays(steps)).toEqual([0, 10, 130, 1330]);
  });
  it("flags steps that land after the window may have closed", () => {
    expect(stepsBeyondWindow(steps)).toEqual([]);
    expect(stepsBeyondWindow([...steps, { delayMinutes: 100 }])).toEqual([4]);
    expect(stepsBeyondWindow([{ delayMinutes: 0 }, { delayMinutes: 24 * 60 }])).toEqual([1]);
  });
});
