import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, pageClient } = vi.hoisted(() => ({
  mockPrisma: {
    facebookPageConnection: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    instagramAccount: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  },
  pageClient: {
    getSystemUser: vi.fn(),
    listSystemUserPages: vi.fn(),
    subscribePageToWebhooks: vi.fn(),
    unsubscribePageFromWebhooks: vi.fn(),
  },
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: (v: string) => v.replace(/^enc:/, ""),
  encryptToken: (v: string) => `enc:${v}`,
}));
vi.mock("@/lib/meta/page-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meta/page-client")>()),
  ...pageClient,
}));

import {
  connectFacebookPage,
  getFacebookPagesState,
  removeFacebookConnection,
  saveSystemUserToken,
  saveUserConnection,
} from "@/lib/facebook/manage-pages";

const pages = [
  { id: "p1", name: "Loja", access_token: "tok-1", tasks: ["MESSAGING", "MODERATE", "ANALYZE"] },
  { id: "p2", name: "Blog", access_token: "tok-2", tasks: ["ANALYZE"] },
];

beforeEach(() => {
  vi.clearAllMocks();
  pageClient.getSystemUser.mockResolvedValue({ id: "su", name: "Robô" });
  pageClient.listSystemUserPages.mockResolvedValue(pages);
  pageClient.subscribePageToWebhooks.mockResolvedValue({ success: true });
  mockPrisma.facebookPageConnection.findUnique.mockResolvedValue({
    systemUserToken: "enc:sys",
    systemUserId: "su",
  });
  mockPrisma.instagramAccount.findMany.mockResolvedValue([]);
  mockPrisma.instagramAccount.findUnique.mockResolvedValue(null);
  mockPrisma.instagramAccount.create.mockResolvedValue({ id: "acct-new" });
  mockPrisma.facebookPageConnection.upsert.mockResolvedValue({});
});

describe("Facebook Pages management", () => {
  it("reports an unconfigured workspace without calling Meta", async () => {
    mockPrisma.facebookPageConnection.findUnique.mockResolvedValue(null);
    await expect(getFacebookPagesState("ws")).resolves.toEqual({
      configured: false,
      pages: [],
      orphaned: [],
    });
    expect(pageClient.listSystemUserPages).not.toHaveBeenCalled();
  });

  it("lists assigned Pages with eligibility and connection state, never the tokens", async () => {
    mockPrisma.instagramAccount.findMany.mockResolvedValue([
      { id: "acct-1", instagramId: "p1", username: "Loja", webhookSubscribed: true },
      { id: "acct-old", instagramId: "gone", username: "Antiga", webhookSubscribed: false },
    ]);
    const state = await getFacebookPagesState("ws");
    expect(pageClient.listSystemUserPages).toHaveBeenCalledWith("sys");
    expect(state.systemUser).toEqual({ id: "su", name: "Robô" });
    expect(state.pages).toEqual([
      {
        id: "p1",
        name: "Loja",
        tasks: ["MESSAGING", "MODERATE", "ANALYZE"],
        eligible: true,
        connected: true,
        accountId: "acct-1",
        webhookSubscribed: true,
      },
      { id: "p2", name: "Blog", tasks: ["ANALYZE"], eligible: false, connected: false },
    ]);
    expect(state.orphaned).toEqual([
      { accountId: "acct-old", pageId: "gone", name: "Antiga", webhookSubscribed: false },
    ]);
    expect(JSON.stringify(state)).not.toContain("tok-");
  });

  it("validates the system user token against Meta before storing it encrypted", async () => {
    await expect(saveSystemUserToken("ws", "raw-token")).resolves.toEqual({
      systemUserId: "su",
      name: "Robô",
    });
    expect(pageClient.getSystemUser).toHaveBeenCalledWith("raw-token");
    const stored = {
      systemUserToken: "enc:raw-token",
      systemUserId: "su",
      tokenKind: "SYSTEM_USER",
      ownerName: "Robô",
      tokenExpiresAt: null,
      dataAccessExpiresAt: null,
    };
    expect(mockPrisma.facebookPageConnection.upsert).toHaveBeenCalledWith({
      where: { workspaceId: "ws" },
      create: { workspaceId: "ws", ...stored },
      update: stored,
    });
  });

  it("refreshes the tokens of already connected Pages when the token is replaced", async () => {
    mockPrisma.instagramAccount.findMany.mockResolvedValue([
      { id: "acct-1", instagramId: "p1", username: "Loja", webhookSubscribed: true },
      { id: "acct-9", instagramId: "gone", username: "Antiga", webhookSubscribed: true },
    ]);
    await saveSystemUserToken("ws", "raw-token");
    // Only the Page the new token still lists gets a new token; nothing is
    // disconnected, so campaigns, flows and logs survive the replacement.
    expect(mockPrisma.instagramAccount.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.instagramAccount.update).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: { accessToken: "enc:tok-1", tokenExpiresAt: null },
    });
    expect(mockPrisma.instagramAccount.deleteMany).not.toHaveBeenCalled();
  });

  it("stores a Connect with Facebook token as a USER connection with its expiry dates", async () => {
    mockPrisma.instagramAccount.findMany.mockResolvedValue([
      { id: "acct-1", instagramId: "p1", username: "Loja", webhookSubscribed: true },
    ]);
    const tokenExpiresAt = new Date("2026-12-25T00:00:00Z");
    const dataAccessExpiresAt = new Date("2027-01-24T00:00:00Z");
    await expect(
      saveUserConnection("ws", {
        token: "user-long",
        ownerId: "u1",
        ownerName: "Matheus",
        tokenExpiresAt,
        dataAccessExpiresAt,
      })
    ).resolves.toEqual({ pages: 2, refreshed: 1 });
    expect(pageClient.listSystemUserPages).toHaveBeenCalledWith("user-long");
    const stored = {
      systemUserToken: "enc:user-long",
      systemUserId: "u1",
      tokenKind: "USER",
      ownerName: "Matheus",
      tokenExpiresAt,
      dataAccessExpiresAt,
    };
    expect(mockPrisma.facebookPageConnection.upsert).toHaveBeenCalledWith({
      where: { workspaceId: "ws" },
      create: { workspaceId: "ws", ...stored },
      update: stored,
    });
    expect(mockPrisma.instagramAccount.update).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: { accessToken: "enc:tok-1", tokenExpiresAt: null },
    });
  });

  it("stores nothing when the Connect with Facebook token cannot list Pages", async () => {
    pageClient.listSystemUserPages.mockRejectedValue(new Error("bad token"));
    await expect(
      saveUserConnection("ws", {
        token: "user-long",
        ownerId: "u1",
        ownerName: null,
        tokenExpiresAt: null,
        dataAccessExpiresAt: null,
      })
    ).rejects.toThrow("bad token");
    expect(mockPrisma.facebookPageConnection.upsert).not.toHaveBeenCalled();
  });

  it("reports the token kind and expiry dates without exposing the token", async () => {
    mockPrisma.facebookPageConnection.findUnique.mockResolvedValue({
      systemUserToken: "enc:user-long",
      systemUserId: "u1",
      tokenKind: "USER",
      tokenExpiresAt: new Date("2026-12-25T00:00:00Z"),
      dataAccessExpiresAt: new Date("2027-01-24T00:00:00Z"),
    });
    const state = await getFacebookPagesState("ws");
    expect(state).toMatchObject({
      configured: true,
      tokenKind: "USER",
      tokenExpiresAt: "2026-12-25T00:00:00.000Z",
      dataAccessExpiresAt: "2027-01-24T00:00:00.000Z",
    });
    expect(JSON.stringify(state)).not.toContain("user-long");
  });

  it("rejects a token Meta does not accept, leaving nothing stored", async () => {
    pageClient.getSystemUser.mockRejectedValue(new Error("bad token"));
    await expect(saveSystemUserToken("ws", "raw-token")).rejects.toThrow("bad token");
    expect(mockPrisma.facebookPageConnection.upsert).not.toHaveBeenCalled();
  });

  it("connects an eligible Page: subscribes the webhook and stores the encrypted Page token", async () => {
    await expect(connectFacebookPage("ws", "p1")).resolves.toEqual({
      accountId: "acct-new",
      webhookSubscribed: true,
    });
    expect(pageClient.subscribePageToWebhooks).toHaveBeenCalledWith("p1", "tok-1");
    expect(mockPrisma.instagramAccount.create).toHaveBeenCalledWith({
      data: {
        username: "Loja",
        name: "Loja",
        accessToken: "enc:tok-1",
        tokenExpiresAt: null,
        webhookSubscribed: true,
        workspaceId: "ws",
        instagramId: "p1",
        provider: "FACEBOOK_PAGE",
      },
      select: { id: true },
    });
  });

  it("still connects when the webhook subscription fails, flagged as pending", async () => {
    pageClient.subscribePageToWebhooks.mockRejectedValue(new Error("boom"));
    await expect(connectFacebookPage("ws", "p1")).resolves.toEqual({
      accountId: "acct-new",
      webhookSubscribed: false,
    });
  });

  it("refuses a Page without the MESSAGING and MODERATE tasks", async () => {
    await expect(connectFacebookPage("ws", "p2")).rejects.toMatchObject({ status: 403 });
    expect(mockPrisma.instagramAccount.create).not.toHaveBeenCalled();
  });

  it("refuses a Page that is not assigned to the system user", async () => {
    await expect(connectFacebookPage("ws", "nope")).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a Page already connected to another workspace", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue({
      id: "x",
      workspaceId: "other",
      provider: "FACEBOOK_PAGE",
    });
    await expect(connectFacebookPage("ws", "p1")).rejects.toMatchObject({ status: 409 });
  });

  it("refreshes an existing connection of the same workspace in place", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue({
      id: "acct-1",
      workspaceId: "ws",
      provider: "FACEBOOK_PAGE",
    });
    await expect(connectFacebookPage("ws", "p1")).resolves.toEqual({
      accountId: "acct-1",
      webhookSubscribed: true,
    });
    expect(mockPrisma.instagramAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acct-1" } })
    );
    expect(mockPrisma.instagramAccount.create).not.toHaveBeenCalled();
  });

  it("keeps the system user token while Pages are still connected", async () => {
    mockPrisma.instagramAccount.count.mockResolvedValue(1);
    await expect(removeFacebookConnection("ws")).rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.facebookPageConnection.deleteMany).not.toHaveBeenCalled();
    mockPrisma.instagramAccount.count.mockResolvedValue(0);
    await removeFacebookConnection("ws");
    expect(mockPrisma.facebookPageConnection.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws" },
    });
  });
});
