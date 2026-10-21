import { beforeEach, describe, expect, it, vi } from "vitest";

const queueAdd = vi.fn();
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: queueAdd }),
  MESSAGE_JOB_NAME: "process-message",
  POSTBACK_JOB_NAME: "process-postback",
}));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    instagramAccount: { findMany: vi.fn() },
    webhookEvent: { create: vi.fn(), update: vi.fn() },
    dmLog: { findMany: vi.fn() },
  },
}));
import { prisma } from "@/lib/db/client";
import { processInstagramWebhook } from "@/lib/queue/process-webhook";

const findMany = vi.mocked(prisma.instagramAccount.findMany);
const createEvent = vi.mocked(prisma.webhookEvent.create);
const updateEvent = vi.mocked(prisma.webhookEvent.update);

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
  vi.mocked(prisma.dmLog.findMany).mockResolvedValue([]);
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
    // The raw payload is stored so the real `from` behaviour can be inspected.
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ object: "page" }) })
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
