import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, queueAdd, sendText, sendButtons, reserve, release } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
    contact: { upsert: vi.fn(), update: vi.fn() },
    flow: { findMany: vi.fn() },
    flowEnrollment: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    flowSendLog: { create: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    dmLog: { findMany: vi.fn() },
    automation: { findFirst: vi.fn() },
  },
  queueAdd: vi.fn(),
  sendText: vi.fn(),
  sendButtons: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: queueAdd }),
  FLOW_STEP_JOB_NAME: "process-flow-step",
}));
vi.mock("@/lib/instagram/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/instagram/provider")>()),
  createInstagramContext: async () => ({ provider: "FACEBOOK_PAGE", pageId: "page_1", accessToken: "tok" }),
  sendDirectMessage: sendText,
  sendDirectMessageWithLinkButton: sendButtons,
}));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: reserve, releaseDMSlot: release }));

import { MetaApiError } from "@/lib/meta/client";
import { handleInboundMessage, markFlowReads, processFlowStep } from "@/lib/flows/engine";

const account = {
  id: "acct",
  workspaceId: "ws",
  instagramId: "page_1",
  provider: "FACEBOOK_PAGE",
  accessToken: "enc",
  zernioAccountId: null,
};
const steps = [
  { id: "s0", position: 0, delayMinutes: 0 },
  { id: "s1", position: 1, delayMinutes: 10 },
  { id: "s2", position: 2, delayMinutes: 120 },
];
const flow = {
  id: "flow1",
  triggerAnyMessage: true,
  triggerKeywords: [],
  wholeWordMatch: false,
  stopKeywords: ["parar", "sair"],
  resumeOnReply: true,
  steps,
};
const now = new Date("2026-10-21T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.findFirst.mockResolvedValue(account);
  mockPrisma.instagramAccount.findUnique.mockResolvedValue(account);
  mockPrisma.contact.upsert.mockResolvedValue({ id: "contact1", optedOutAt: null });
  mockPrisma.contact.update.mockResolvedValue({});
  mockPrisma.flow.findMany.mockResolvedValue([flow]);
  mockPrisma.flowEnrollment.findMany.mockResolvedValue([]);
  mockPrisma.flowEnrollment.create.mockResolvedValue({ id: "enr1" });
  mockPrisma.flowEnrollment.update.mockResolvedValue({});
  mockPrisma.flowEnrollment.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.flowSendLog.create.mockResolvedValue({});
  mockPrisma.flowSendLog.upsert.mockResolvedValue({});
  mockPrisma.flowSendLog.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.flowSendLog.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.dmLog.findMany.mockResolvedValue([]);
  queueAdd.mockResolvedValue({});
  sendText.mockResolvedValue({ recipient_id: "psid1", message_id: "m_text" });
  sendButtons.mockResolvedValue({ recipient_id: "psid1", message_id: "m_btn" });
  reserve.mockResolvedValue({ allowed: true, reserved: true, shouldRequeue: false, requeueDelayMs: 0 });
});

const inbound = { accountConnectionId: "acct", instagramAccountId: "page_1", psid: "psid1", text: "oi", at: now };

describe("handleInboundMessage", () => {
  it("records the contact, enrolls in a matching flow and schedules step 0", async () => {
    const result = await handleInboundMessage(inbound);
    expect(result).toEqual({ enrolled: ["enr1"], resumed: [], stopped: false });
    expect(mockPrisma.contact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { instagramAccountId_psid: { instagramAccountId: "acct", psid: "psid1" } },
        update: { lastInboundAt: now },
      })
    );
    expect(mockPrisma.flowEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ flowId: "flow1", contactId: "contact1", automationId: null }),
      })
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "process-flow-step",
      expect.objectContaining({ enrollmentId: "enr1", stepId: "s0", stepPosition: 0, accountConnectionId: "acct" }),
      expect.objectContaining({ delay: 0, jobId: expect.stringMatching(/^flow_enr1_s0_\d+$/) })
    );
  });

  it("ties the enrollment to the comment-to-DM campaign that brought the person", async () => {
    mockPrisma.flow.findMany.mockResolvedValue([{ ...flow, triggerAnyMessage: false }]);
    mockPrisma.dmLog.findMany.mockResolvedValue([{ automationId: "auto1", automation: { flowId: "flow1" } }]);
    await handleInboundMessage(inbound);
    expect(mockPrisma.flowEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowId: "flow1", automationId: "auto1" }) })
    );
  });

  it("does not enroll twice and ignores non-matching keyword flows", async () => {
    mockPrisma.flowEnrollment.findMany.mockResolvedValue([
      { id: "old", flowId: "flow1", status: "COMPLETED", nextStepPosition: 3 },
    ]);
    await handleInboundMessage(inbound);
    expect(mockPrisma.flowEnrollment.create).not.toHaveBeenCalled();

    mockPrisma.flowEnrollment.findMany.mockResolvedValue([]);
    mockPrisma.flow.findMany.mockResolvedValue([{ ...flow, triggerAnyMessage: false, triggerKeywords: ["ebook"] }]);
    await handleInboundMessage(inbound);
    expect(mockPrisma.flowEnrollment.create).not.toHaveBeenCalled();
  });

  it("a stop word ends every enrollment, opts the person out and confirms", async () => {
    const result = await handleInboundMessage({ ...inbound, text: "PARAR" });
    expect(result.stopped).toBe(true);
    expect(mockPrisma.flowEnrollment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contactId: "contact1" }),
        data: expect.objectContaining({ status: "STOPPED_OPTOUT" }),
      })
    );
    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { optedOutAt: now } })
    );
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ userId: "psid1" }));
    expect(mockPrisma.flowEnrollment.create).not.toHaveBeenCalled();
  });

  it("never enrolls someone who opted out", async () => {
    mockPrisma.contact.upsert.mockResolvedValue({ id: "contact1", optedOutAt: new Date() });
    await handleInboundMessage(inbound);
    expect(mockPrisma.flowEnrollment.create).not.toHaveBeenCalled();
  });

  it("resumes a window-paused enrollment from its pending step", async () => {
    mockPrisma.flowEnrollment.findMany.mockResolvedValue([
      { id: "paused", flowId: "flow1", status: "PAUSED_WINDOW", nextStepPosition: 2 },
    ]);
    const result = await handleInboundMessage(inbound);
    expect(result.resumed).toEqual(["paused"]);
    expect(mockPrisma.flowEnrollment.update).toHaveBeenCalledWith({ where: { id: "paused" }, data: { status: "ACTIVE" } });
    expect(queueAdd).toHaveBeenCalledWith(
      "process-flow-step",
      expect.objectContaining({ enrollmentId: "paused", stepId: "s2", stepPosition: 2 }),
      expect.objectContaining({ delay: 0 })
    );
    expect(mockPrisma.flowEnrollment.create).not.toHaveBeenCalled();
  });
});

function enrollmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "enr1",
    status: "ACTIVE",
    nextStepPosition: 1,
    contact: { id: "contact1", psid: "psid1", name: "Ana", lastInboundAt: now, optedOutAt: null, humanTakeoverUntil: null },
    flow: {
      id: "flow1",
      isActive: true,
      instagramAccountId: "acct",
      steps: [
        { ...steps[0], message: "oi {username}", buttons: [] },
        { ...steps[1], message: "olha isso, {username}", buttons: [{ id: "b1", title: "Ver oferta", slug: "abc", url: "https://x.test" }] },
        { ...steps[2], message: "última", buttons: [] },
      ],
    },
    ...overrides,
  };
}

const job = (data: Record<string, unknown> = {}) =>
  ({ id: "job1", data: { accountConnectionId: "acct", instagramAccountId: "page_1", enrollmentId: "enr1", stepId: "s1", stepPosition: 1, ...data } }) as never;

describe("processFlowStep", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(now.getTime() + 60_000) });
    mockPrisma.flowEnrollment.findUnique.mockResolvedValue(enrollmentRow());
  });
  afterEach(() => vi.useRealTimers());

  it("claims, sends the step with its CTA buttons, records the mid and schedules the next step", async () => {
    await processFlowStep(job());
    expect(mockPrisma.flowSendLog.create).toHaveBeenCalledWith({
      data: { enrollmentId: "enr1", stepId: "s1", status: "CLAIMED" },
    });
    expect(mockPrisma.flowSendLog.create.mock.invocationCallOrder[0]).toBeLessThan(sendButtons.mock.invocationCallOrder[0]);
    expect(sendButtons).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "psid1",
        text: "olha isso, Ana",
        buttons: [{ title: "Ver oferta", url: expect.stringMatching(/\/r\/abc\?r=[A-Za-z0-9_-]{22}$/) }],
      })
    );
    expect(mockPrisma.flowSendLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enrollmentId_stepId: { enrollmentId: "enr1", stepId: "s1" } },
        update: expect.objectContaining({ status: "SENT", mid: "m_btn" }),
      })
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "process-flow-step",
      expect.objectContaining({ stepId: "s2", stepPosition: 2 }),
      expect.objectContaining({ delay: 120 * 60_000 })
    );
  });

  it("completes the enrollment after the last step", async () => {
    mockPrisma.flowEnrollment.findUnique.mockResolvedValue(enrollmentRow({ nextStepPosition: 2 }));
    await processFlowStep(job({ stepId: "s2", stepPosition: 2 }));
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(mockPrisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) })
    );
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("skips without calling Meta when the window is closed, and pauses", async () => {
    vi.setSystemTime(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    await processFlowStep(job());
    expect(sendButtons).not.toHaveBeenCalled();
    expect(mockPrisma.flowSendLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.flowSendLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: "SKIPPED_WINDOW" }) })
    );
    expect(mockPrisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAUSED_WINDOW" }) })
    );
  });

  it("does nothing for a stale job or an inactive enrollment", async () => {
    await processFlowStep(job({ stepId: "s0", stepPosition: 0 }));
    mockPrisma.flowEnrollment.findUnique.mockResolvedValue(enrollmentRow({ status: "STOPPED_OPTOUT" }));
    await processFlowStep(job());
    expect(sendButtons).not.toHaveBeenCalled();
    expect(mockPrisma.flowSendLog.create).not.toHaveBeenCalled();
  });

  it("never sends when the step was already claimed", async () => {
    mockPrisma.flowSendLog.create.mockRejectedValue({ code: "P2002" });
    mockPrisma.flowSendLog.updateMany.mockResolvedValue({ count: 0 });
    await processFlowStep(job());
    expect(sendButtons).not.toHaveBeenCalled();
  });

  it("re-claims a step that was skipped earlier (resume after the window reopened)", async () => {
    mockPrisma.flowSendLog.create.mockRejectedValue({ code: "P2002" });
    mockPrisma.flowSendLog.updateMany.mockResolvedValue({ count: 1 });
    await processFlowStep(job());
    expect(mockPrisma.flowSendLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ["SKIPPED_WINDOW", "SKIPPED_TAKEOVER"] } }) })
    );
    expect(sendButtons).toHaveBeenCalledTimes(1);
  });

  it("releases the claim and requeues when the hourly limit is hit", async () => {
    reserve.mockResolvedValue({ allowed: false, reserved: false, shouldRequeue: true, requeueDelayMs: 5000 });
    await processFlowStep(job());
    expect(mockPrisma.flowSendLog.deleteMany).toHaveBeenCalled();
    expect(sendButtons).not.toHaveBeenCalled();
    expect(queueAdd).toHaveBeenCalledWith(
      "process-flow-step",
      expect.objectContaining({ requeueAttempt: 1 }),
      expect.objectContaining({ delay: 5000 })
    );
  });

  it("pauses on Meta's own closed-window rejection", async () => {
    sendButtons.mockRejectedValue(new MetaApiError(10, 2018278, "t", "This message is sent outside of allowed window."));
    await processFlowStep(job());
    expect(mockPrisma.flowSendLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: "SKIPPED_WINDOW" }) })
    );
    expect(mockPrisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAUSED_WINDOW" }) })
    );
    expect(release).toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("records other failures and still moves on to the next step", async () => {
    sendButtons.mockRejectedValue(new Error("connection reset"));
    await processFlowStep(job());
    expect(mockPrisma.flowSendLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(queueAdd).toHaveBeenCalledWith("process-flow-step", expect.objectContaining({ stepId: "s2" }), expect.anything());
  });

  it("falls back to inline links when Meta rejects the button template", async () => {
    sendButtons.mockRejectedValue(new MetaApiError(100, undefined, "t", "Invalid button template"));
    await processFlowStep(job());
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Ver oferta: ") })
    );
    expect(mockPrisma.flowSendLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: "SENT", mid: "m_text" }) })
    );
  });
});

describe("markFlowReads", () => {
  it("marks the person's sent steps up to the watermark as read", async () => {
    mockPrisma.flowSendLog.updateMany.mockResolvedValue({ count: 2 });
    const count = await markFlowReads({ accountConnectionId: "acct", instagramAccountId: "page_1", psid: "psid1", watermark: now.getTime() });
    expect(count).toBe(2);
    expect(mockPrisma.flowSendLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "SENT",
          readAt: null,
          sentAt: { lte: now },
          enrollment: { contact: { instagramAccountId: "acct", psid: "psid1" } },
        },
      })
    );
  });
});
