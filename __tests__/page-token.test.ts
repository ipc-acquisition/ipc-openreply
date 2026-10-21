import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, listPages } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findUnique: vi.fn(), update: vi.fn() },
    facebookPageConnection: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  listPages: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: (v: string) => `dec:${v}`,
  encryptToken: (v: string) => `enc:${v}`,
}));
vi.mock("@/lib/meta/page-client", () => ({ listSystemUserPages: listPages }));

import { refreshFacebookPageToken } from "@/lib/facebook/page-token";

const pageAccount = {
  id: "acct",
  instagramId: "page_1",
  provider: "FACEBOOK_PAGE",
  workspaceId: "ws",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.update.mockResolvedValue({});
  mockPrisma.operationalEvent.create.mockResolvedValue({});
});

describe("refreshFacebookPageToken", () => {
  it("stores the Page token re-read from the system user", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(pageAccount);
    mockPrisma.facebookPageConnection.findUnique.mockResolvedValue({ systemUserToken: "sys" });
    listPages.mockResolvedValue([
      { id: "other", name: "Other", access_token: "t-other" },
      { id: "page_1", name: "Mine", access_token: "t-new" },
    ]);

    await expect(refreshFacebookPageToken("acct")).resolves.toBe(true);
    expect(listPages).toHaveBeenCalledWith("dec:sys");
    expect(mockPrisma.instagramAccount.update).toHaveBeenCalledWith({
      where: { id: "acct" },
      data: { accessToken: "enc:t-new", tokenExpiresAt: null },
    });
  });

  it("does nothing for non-Page accounts", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue({ ...pageAccount, provider: "META" });
    await expect(refreshFacebookPageToken("acct")).resolves.toBe(false);
    expect(mockPrisma.facebookPageConnection.findUnique).not.toHaveBeenCalled();
    expect(listPages).not.toHaveBeenCalled();
  });

  it("does nothing without a system user connection", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(pageAccount);
    mockPrisma.facebookPageConnection.findUnique.mockResolvedValue(null);
    await expect(refreshFacebookPageToken("acct")).resolves.toBe(false);
    expect(listPages).not.toHaveBeenCalled();
  });

  it("records a warning when the Page is no longer assigned", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(pageAccount);
    mockPrisma.facebookPageConnection.findUnique.mockResolvedValue({ systemUserToken: "sys" });
    listPages.mockResolvedValue([{ id: "other", name: "Other", access_token: "t" }]);

    await expect(refreshFacebookPageToken("acct")).resolves.toBe(false);
    expect(mockPrisma.instagramAccount.update).not.toHaveBeenCalled();
    expect(mockPrisma.operationalEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ level: "WARNING", workspaceId: "ws" }) })
    );
  });
});
