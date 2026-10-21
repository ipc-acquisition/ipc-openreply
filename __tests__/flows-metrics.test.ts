import { describe, expect, it } from "vitest";
import { countUniqueClicks, summarizeSteps, totalsOf } from "@/lib/flows/metrics";

const steps = [
  { id: "s0", buttons: [] },
  { id: "s1", buttons: [{ id: "b1" }, { id: "b2" }] },
];
const read = new Date();

describe("flow metrics", () => {
  it("counts clicks once per person, falling back to ip, then to the row", () => {
    expect(
      countUniqueClicks([
        { id: "1", buttonId: "b", recipientHash: "p1", ipHash: "a" },
        { id: "2", buttonId: "b", recipientHash: "p1", ipHash: "b" },
        { id: "3", buttonId: "b", recipientHash: null, ipHash: "a" },
        { id: "4", buttonId: "b", recipientHash: null, ipHash: "a" },
        { id: "5", buttonId: "b", recipientHash: null, ipHash: null },
        { id: "6", buttonId: "b", recipientHash: null, ipHash: null },
      ])
    ).toBe(4);
  });

  it("summarizes sent, read, clicks, open rate and CTR per step", () => {
    const metrics = summarizeSteps(
      steps,
      [
        { stepId: "s0", status: "SENT", readAt: read },
        { stepId: "s0", status: "SENT", readAt: null },
        { stepId: "s0", status: "FAILED", readAt: null },
        { stepId: "s1", status: "SENT", readAt: read },
        { stepId: "s1", status: "SENT", readAt: read },
        { stepId: "s1", status: "SENT", readAt: null },
        { stepId: "s1", status: "SENT", readAt: null },
        { stepId: "s1", status: "SKIPPED_WINDOW", readAt: null },
        { stepId: "s1", status: "SKIPPED_OPTOUT", readAt: null },
      ],
      [
        { id: "c1", buttonId: "b1", recipientHash: "p1", ipHash: null },
        { id: "c2", buttonId: "b1", recipientHash: "p1", ipHash: null },
        { id: "c3", buttonId: "b2", recipientHash: "p1", ipHash: null },
        { id: "c4", buttonId: "b2", recipientHash: "p2", ipHash: null },
      ]
    );
    expect(metrics[0]).toMatchObject({ stepId: "s0", sent: 2, read: 1, failed: 1, clicks: 0, openRate: 0.5, ctr: 0 });
    expect(metrics[1]).toMatchObject({
      stepId: "s1",
      sent: 4,
      read: 2,
      skippedWindow: 1,
      skippedOther: 1,
      // p1 tapped both buttons: one person for the step, one per button.
      clicks: 2,
      openRate: 0.5,
      ctr: 0.5,
      buttons: [
        { buttonId: "b1", clicks: 1 },
        { buttonId: "b2", clicks: 2 },
      ],
    });
    expect(totalsOf(metrics)).toEqual({ sent: 6, read: 3, clicks: 2, openRate: 0.5, ctr: 2 / 6 });
  });

  it("reports zeros, not NaN, for steps never sent", () => {
    const [m] = summarizeSteps([{ id: "s0", buttons: [] }], [], []);
    expect(m).toMatchObject({ sent: 0, read: 0, clicks: 0, openRate: 0, ctr: 0 });
  });
});
