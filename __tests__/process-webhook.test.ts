import { beforeEach, describe, expect, it, vi } from "vitest";

const queueAdd = vi.fn();
const workerQueueAdd = vi.fn();
const resetWebhookQueue = vi.fn();
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: workerQueueAdd }),
  getWebhookQueue: () => ({ add: queueAdd }),
  resetWebhookQueue: () => resetWebhookQueue(),
  MESSAGE_JOB_NAME: "process-message",
  POSTBACK_JOB_NAME: "process-postback",
}));
const markFlowReads = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flows/engine", () => ({ markFlowReads }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    instagramAccount: { findMany: vi.fn() },
    webhookEvent: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    dmLog: { findMany: vi.fn() },
  },
}));
import { prisma } from "@/lib/db/client";
import {
  processInstagramWebhook,
  replayUnqueuedWebhookEvents,
} from "@/lib/queue/process-webhook";

const findMany = vi.mocked(prisma.instagramAccount.findMany);
const createEvent = vi.mocked(prisma.webhookEvent.create);
const updateEvent = vi.mocked(prisma.webhookEvent.update);
const updateManyEvents = vi.mocked(prisma.webhookEvent.updateMany);
const findEvents = vi.mocked(prisma.webhookEvent.findMany);

const pagePayload = {
  object: "page",
  entry: [
    {
      id: "page_1",
      time: 1,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "post_c1",
            post_id: "page_1_post",
            message: "quero",
          },
        },
      ],
    },
  ],
} as Parameters<typeof processInstagramWebhook>[0]["payload"];

beforeEach(() => {
  vi.clearAllMocks();
  createEvent.mockResolvedValue({ id: "evt" } as Awaited<ReturnType<typeof prisma.webhookEvent.create>>);
  updateEvent.mockResolvedValue({} as Awaited<ReturnType<typeof prisma.webhookEvent.update>>);
  updateManyEvents.mockResolvedValue({ count: 0 });
  findEvents.mockResolvedValue([]);
  vi.mocked(prisma.dmLog.findMany).mockResolvedValue([]);
  queueAdd.mockResolvedValue({});
  workerQueueAdd.mockResolvedValue({});
});

describe("processInstagramWebhook with a Page payload", () => {
  it("looks up Page accounts under the FACEBOOK_PAGE provider and enqueues the comment", async () => {
    findMany.mockResolvedValue([
      { id: "acct", instagramId: "page_1", workspaceId: "ws" },
    ] as Awaited<ReturnType<typeof prisma.instagramAccount.findMany>>);

    await processInstagramWebhook({ payload: pagePayload, provider: "FACEBOOK_PAGE" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provider: "FACEBOOK_PAGE", instagramId: { in: ["page_1"] } }),
      })
    );
    // The raw payload is stored so the real `from` behaviour can be inspected,
    // with the provider the replay needs.
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ object: "page", provider: "FACEBOOK_PAGE" }) })
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({
        instagramAccountId: "page_1",
        accountConnectionId: "acct",
        commentId: "post_c1",
        commenterId: "comment:post_c1",
        mediaId: "page_1_post",
        source: "WEBHOOK",
      }),
      { jobId: "comment_page_1_post_c1" }
    );
    expect(updateEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSED" }) })
    );
    expect(resetWebhookQueue).not.toHaveBeenCalled();
  });

  it("drops the payload when no connected Page matches", async () => {
    findMany.mockResolvedValue([]);
    await processInstagramWebhook({ payload: pagePayload, provider: "FACEBOOK_PAGE" });
    expect(createEvent).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("ignores objects that are neither instagram nor page", async () => {
    await processInstagramWebhook({
      payload: { object: "user", entry: [] } as unknown as typeof pagePayload,
      provider: "META",
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});

const pageAccount = [
  { id: "acct", instagramId: "page_1", workspaceId: "ws" },
] as Awaited<ReturnType<typeof prisma.instagramAccount.findMany>>;

const messagePayload = {
  object: "page",
  entry: [
    {
      id: "page_1",
      time: 1,
      messaging: [
        {
          sender: { id: "psid_1" },
          recipient: { id: "page_1" },
          message: { mid: "m_1", text: "quero" },
        },
      ],
    },
  ],
} as Parameters<typeof processInstagramWebhook>[0]["payload"];

describe("processInstagramWebhook when Redis is unreachable", () => {
  it("gives up after the timeout, keeps the event as NOT_ENQUEUED and does not throw", async () => {
    vi.useFakeTimers();
    try {
      findMany.mockResolvedValue(pageAccount);
      // What BullMQ does while Redis is down: wait for the connection forever.
      queueAdd.mockReturnValue(new Promise(() => {}));

      const done = processInstagramWebhook({ payload: messagePayload, provider: "FACEBOOK_PAGE" });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(done).resolves.toBeUndefined();

      expect(updateEvent).toHaveBeenLastCalledWith({
        where: { id: "evt" },
        data: expect.objectContaining({
          status: "NOT_ENQUEUED",
          errorMessage: expect.stringContaining("timed out"),
        }),
      });
      // The stuck connection is dropped so the late add cannot land later.
      expect(resetWebhookQueue).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the event NOT_ENQUEUED when the enqueue fails outright", async () => {
    findMany.mockResolvedValue(pageAccount);
    queueAdd.mockRejectedValue(new Error("Stream is not writeable"));

    await expect(
      processInstagramWebhook({ payload: messagePayload, provider: "FACEBOOK_PAGE" })
    ).resolves.toBeUndefined();

    expect(updateEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NOT_ENQUEUED" }) })
    );
  });

  it("still throws when the payload could not be persisted, so Meta retries", async () => {
    findMany.mockResolvedValue(pageAccount);
    createEvent.mockRejectedValue(new Error("db down"));

    await expect(
      processInstagramWebhook({ payload: messagePayload, provider: "FACEBOOK_PAGE" })
    ).rejects.toThrow("db down");
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe("replayUnqueuedWebhookEvents", () => {
  const now = new Date("2026-10-21T12:00:00.000Z");
  const storedEvent = (overrides: Record<string, unknown> = {}) =>
    ({ id: "evt_1", payload: messagePayload, provider: "FACEBOOK_PAGE", ...overrides }) as unknown as Awaited<
      ReturnType<typeof prisma.webhookEvent.findMany>
    >[number];

  it("re-enqueues a NOT_ENQUEUED message and marks it PROCESSED", async () => {
    findMany.mockResolvedValue(pageAccount);
    findEvents.mockResolvedValue([storedEvent()]);

    const result = await replayUnqueuedWebhookEvents({ now });

    expect(result).toEqual({ replayed: 1, failed: 0, expired: 0 });
    // Only rows inside the 24h window, NOT_ENQUEUED or stale PENDING.
    expect(findEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: { gte: new Date("2026-10-20T12:00:00.000Z") },
          OR: [
            { status: "NOT_ENQUEUED" },
            { status: "PENDING", createdAt: { lt: new Date("2026-10-21T11:55:00.000Z") } },
          ],
        },
      })
    );
    expect(workerQueueAdd).toHaveBeenCalledWith(
      "process-message",
      expect.objectContaining({ messageId: "m_1", senderId: "psid_1", accountConnectionId: "acct" }),
      { jobId: `message_page_1_${Buffer.from("m_1").toString("base64url")}` }
    );
    expect(updateEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "evt_1" },
        data: expect.objectContaining({ status: "PROCESSED" }),
      })
    );
  });

  it("uses the same job id as the original delivery, so BullMQ dedupes a double enqueue", async () => {
    findMany.mockResolvedValue(pageAccount);
    await processInstagramWebhook({ payload: messagePayload, provider: "FACEBOOK_PAGE" });
    findEvents.mockResolvedValue([storedEvent()]);
    await replayUnqueuedWebhookEvents({ now });

    const originalJobId = queueAdd.mock.calls[0][2];
    const replayedJobId = workerQueueAdd.mock.calls[0][2];
    expect(replayedJobId).toEqual(originalJobId);
  });

  it("falls back to the payload object for rows written before provider was stored", async () => {
    findMany.mockResolvedValue(pageAccount);
    findEvents.mockResolvedValue([storedEvent({ provider: null })]);

    await replayUnqueuedWebhookEvents({ now });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ provider: "FACEBOOK_PAGE" }) })
    );
    expect(workerQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("expires rows older than the window instead of replaying them", async () => {
    updateManyEvents.mockResolvedValue({ count: 2 });

    const result = await replayUnqueuedWebhookEvents({ now });

    expect(result.expired).toBe(2);
    expect(updateManyEvents).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date("2026-10-20T12:00:00.000Z") },
        OR: [{ status: "NOT_ENQUEUED" }, { status: "PENDING" }],
      },
      data: expect.objectContaining({ status: "FAILED" }),
    });
  });

  it("stops the sweep at the first failure while Redis is still down", async () => {
    findMany.mockResolvedValue(pageAccount);
    findEvents.mockResolvedValue([storedEvent({ id: "evt_1" }), storedEvent({ id: "evt_2" })]);
    workerQueueAdd.mockRejectedValue(new Error("Connection is closed"));

    const result = await replayUnqueuedWebhookEvents({ now });

    expect(result).toEqual({ replayed: 0, failed: 1, expired: 0 });
    expect(workerQueueAdd).toHaveBeenCalledTimes(1);
    expect(updateEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "evt_1" },
        data: expect.objectContaining({ status: "NOT_ENQUEUED" }),
      })
    );
  });

  it("drops entries of accounts disconnected since the event arrived", async () => {
    findMany.mockResolvedValue([]);
    findEvents.mockResolvedValue([storedEvent()]);

    const result = await replayUnqueuedWebhookEvents({ now });

    expect(result.replayed).toBe(1);
    expect(workerQueueAdd).not.toHaveBeenCalled();
  });
});
