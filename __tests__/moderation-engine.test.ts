import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, hide } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findFirst: vi.fn() },
    moderationRule: { findMany: vi.fn() },
    moderationLog: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  hide: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (v: string) => `dec:${v}` }));
vi.mock("@/lib/meta/page-client", () => ({ setPageCommentHidden: hide }));

import { findMatchingRule, moderateComment, unhideComment } from "@/lib/moderation/engine";
import { normalizeForModeration } from "@/lib/moderation/normalize";

const pageAccount = { id: "acct", workspaceId: "ws", provider: "FACEBOOK_PAGE", accessToken: "tok" };
const rule = { id: "rule1", keywords: ["fake", "golpe"], wholeWordMatch: false, action: "HIDE" };
const input = {
  accountConnectionId: "acct",
  instagramAccountId: "page_1",
  commentId: "c1",
  commentText: "isso é FAKEE demais",
  commenterId: "comment:c1",
  mediaId: "page_1_post",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.findFirst.mockResolvedValue(pageAccount);
  mockPrisma.moderationRule.findMany.mockResolvedValue([rule]);
  mockPrisma.moderationLog.findUnique.mockResolvedValue(null);
  mockPrisma.moderationLog.create.mockResolvedValue({ id: "log1", actionStatus: "PENDING", matchedKeyword: "fake" });
  mockPrisma.moderationLog.update.mockResolvedValue({});
  hide.mockResolvedValue({ success: true });
});

describe("normalizeForModeration", () => {
  it("collapses repeats, folds accents and undoes leetspeak", () => {
    expect(normalizeForModeration("FAKEEE")).toBe("fake");
    expect(normalizeForModeration("f4k3")).toBe("fake");
    expect(normalizeForModeration("Gólpe!!")).toBe("golpe");
    expect(normalizeForModeration("g0lp3 $uporte")).toBe("golpe suporte");
  });
});

describe("findMatchingRule", () => {
  it("matches variations inside longer words when whole-word is off", () => {
    expect(findMatchingRule("isso é fakee demais", [rule])).toEqual({ rule, keyword: "fake" });
    expect(findMatchingRule("gólpe!!!", [rule])?.keyword).toBe("golpe");
    expect(findMatchingRule("comentário honesto", [rule])).toBeNull();
  });

  it("respects whole-word rules", () => {
    const strict = { ...rule, wholeWordMatch: true };
    expect(findMatchingRule("fakes", [strict])).toBeNull();
    expect(findMatchingRule("é fake", [strict])?.keyword).toBe("fake");
  });
});

describe("moderateComment", () => {
  it("claims the log before hiding, then records DONE and blocks campaigns", async () => {
    const decision = await moderateComment(input);
    expect(decision).toEqual({ blocked: true, logId: "log1", matchedKeyword: "fake" });
    expect(mockPrisma.moderationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "ws",
          instagramAccountId: "acct",
          ruleId: "rule1",
          commentId: "c1",
          matchedKeyword: "fake",
          action: "HIDE",
          actionStatus: "PENDING",
        }),
      })
    );
    // Claim first, Meta second.
    expect(mockPrisma.moderationLog.create.mock.invocationCallOrder[0]).toBeLessThan(
      hide.mock.invocationCallOrder[0]
    );
    expect(hide).toHaveBeenCalledWith("dec:tok", "c1", true);
    expect(mockPrisma.moderationLog.update).toHaveBeenCalledWith({
      where: { id: "log1" },
      data: { actionStatus: "DONE", error: null },
    });
  });

  it("lets clean comments through without touching the log", async () => {
    await expect(moderateComment({ ...input, commentText: "adorei o post" })).resolves.toEqual({ blocked: false });
    expect(mockPrisma.moderationLog.create).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it("does nothing when the Page has no active rules", async () => {
    mockPrisma.moderationRule.findMany.mockResolvedValue([]);
    await expect(moderateComment(input)).resolves.toEqual({ blocked: false });
    expect(mockPrisma.moderationLog.findUnique).not.toHaveBeenCalled();
  });

  it("reuses an existing decision instead of calling Meta again", async () => {
    mockPrisma.moderationLog.findUnique.mockResolvedValue({ id: "old", actionStatus: "DONE", matchedKeyword: "fake" });
    await expect(moderateComment(input)).resolves.toEqual({ blocked: true, logId: "old", matchedKeyword: "fake" });
    expect(hide).not.toHaveBeenCalled();
    expect(mockPrisma.moderationLog.create).not.toHaveBeenCalled();
  });

  it("lets a manually unhidden comment through to campaigns", async () => {
    mockPrisma.moderationLog.findUnique.mockResolvedValue({ id: "old", actionStatus: "UNDONE", matchedKeyword: "fake" });
    await expect(moderateComment(input)).resolves.toEqual({ blocked: false });
  });

  it("still blocks campaigns when the hide call fails, and records the error", async () => {
    hide.mockRejectedValue(new Error("boom"));
    const decision = await moderateComment(input);
    expect(decision.blocked).toBe(true);
    expect(mockPrisma.moderationLog.update).toHaveBeenCalledWith({
      where: { id: "log1" },
      data: { actionStatus: "FAILED", error: "boom" },
    });
  });

  it("defers to the winner when a concurrent job already claimed the comment", async () => {
    mockPrisma.moderationLog.create.mockRejectedValue({ code: "P2002" });
    mockPrisma.moderationLog.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner", actionStatus: "DONE", matchedKeyword: "fake" });
    await expect(moderateComment(input)).resolves.toEqual({ blocked: true, logId: "winner", matchedKeyword: "fake" });
    expect(hide).not.toHaveBeenCalled();
  });

  it("only records, never calls Meta, for non-Page accounts", async () => {
    mockPrisma.instagramAccount.findFirst.mockResolvedValue({ ...pageAccount, provider: "META" });
    const decision = await moderateComment(input);
    expect(decision.blocked).toBe(true);
    expect(hide).not.toHaveBeenCalled();
    expect(mockPrisma.moderationLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actionStatus: "FAILED" }) })
    );
  });
});

describe("unhideComment", () => {
  it("re-shows the comment and marks the log UNDONE", async () => {
    mockPrisma.moderationLog.findFirst.mockResolvedValue({
      id: "log1",
      commentId: "c1",
      instagramAccount: { provider: "FACEBOOK_PAGE", accessToken: "tok" },
    });
    await unhideComment("ws", "log1");
    expect(hide).toHaveBeenCalledWith("dec:tok", "c1", false);
    expect(mockPrisma.moderationLog.update).toHaveBeenCalledWith({
      where: { id: "log1" },
      data: { actionStatus: "UNDONE", error: null },
    });
  });

  it("refuses logs outside the workspace", async () => {
    mockPrisma.moderationLog.findFirst.mockResolvedValue(null);
    await expect(unhideComment("ws", "nope")).rejects.toThrow("not found");
    expect(hide).not.toHaveBeenCalled();
  });
});
