import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/client", () => ({
  prisma: { zernioConnection: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: (value: string) => `decrypted:${value}`,
}));
import {
  createInstagramContext,
  getConversations,
  getFollowerCountSeries,
  getMediaInsights,
  getRecentMediaComments,
  getUserFollowStatus,
  getUserInfo,
  getUserMedia,
  PermissionError,
  providerCapabilities,
  sendCommentReply,
  sendDirectMessage,
  sendPrivateReply,
  sendPrivateReplyWithLinkButton,
} from "@/lib/instagram/provider";

const context = {
  provider: "FACEBOOK_PAGE" as const,
  pageId: "page-1",
  accessToken: "page-token",
};
const fetchMock = vi.fn();
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}
function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url: new URL(url),
    init,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Facebook Page provider boundary", () => {
  it("builds the Page context from the account row", async () => {
    expect(
      await createInstagramContext({
        provider: "FACEBOOK_PAGE",
        workspaceId: "workspace",
        zernioAccountId: null,
        instagramId: "page-1",
        accessToken: "encrypted",
      })
    ).toEqual({ ...context, accessToken: "decrypted:encrypted" });
  });

  it("routes the private reply to the Page's messages edge and returns the PSID", async () => {
    respond({ recipient_id: "psid-7", message_id: "m_1" });
    const result = await sendPrivateReply({
      context,
      instagramAccountId: "page-1",
      commentId: "c1",
      message: "oi",
    });
    expect(result).toEqual({ recipient_id: "psid-7", message_id: "m_1" });
    const call = lastCall();
    expect(call.url.origin).toBe("https://graph.facebook.com");
    expect(call.url.pathname).toMatch(/\/page-1\/messages$/);
    expect(call.body).toEqual({ recipient: { comment_id: "c1" }, message: { text: "oi" } });
  });

  it("sends link buttons as a web_url button template", async () => {
    respond({ recipient_id: "p", message_id: "m" });
    await sendPrivateReplyWithLinkButton({
      context,
      instagramAccountId: "page-1",
      commentId: "c1",
      text: "link",
      buttons: [{ title: "Abrir", url: "https://example.com" }],
    });
    expect(lastCall().body.message.attachment.payload.buttons[0]).toEqual({
      type: "web_url",
      url: "https://example.com",
      title: "Abrir",
    });
  });

  it("sends DMs by PSID as RESPONSE messages", async () => {
    respond({ recipient_id: "psid-7", message_id: "m" });
    await sendDirectMessage({
      context,
      instagramAccountId: "page-1",
      userId: "psid-7",
      message: "segue",
    });
    expect(lastCall().body).toEqual({
      recipient: { id: "psid-7" },
      messaging_type: "RESPONSE",
      message: { text: "segue" },
    });
  });

  it("posts public replies on the comment", async () => {
    respond({ id: "c1_r" });
    expect(await sendCommentReply({ context, commentId: "c1", message: "valeu" })).toEqual({
      id: "c1_r",
    });
    expect(lastCall().url.pathname).toMatch(/\/c1\/comments$/);
  });

  it("maps Page comments into the Instagram comment shape the reconciler reads", async () => {
    respond({
      data: [
        {
          id: "c1",
          message: "quero",
          created_time: "2026-10-21T12:00:00+0000",
          from: { id: "u1", name: "Ana" },
          comments: { data: [{ id: "r1", from: { id: "page-1", name: "Página" } }] },
        },
        { id: "c2", message: "eu também", created_time: "2026-10-21T11:00:00+0000" },
      ],
    });
    const comments = await getRecentMediaComments({ context, mediaId: "post-1", sinceMs: 0 });
    expect(comments).toEqual([
      {
        id: "c1",
        text: "quero",
        timestamp: "2026-10-21T12:00:00+0000",
        from: { id: "u1", username: "Ana" },
        replies: { data: [{ id: "r1", from: { id: "page-1", username: "Página" } }] },
      },
      {
        id: "c2",
        text: "eu também",
        timestamp: "2026-10-21T11:00:00+0000",
        from: undefined,
        replies: { data: undefined },
      },
    ]);
    expect(lastCall().url.pathname).toMatch(/\/post-1\/comments$/);
  });

  it("lists published posts as media", async () => {
    respond({
      data: [
        {
          id: "post-1",
          message: "legenda",
          created_time: "2026-10-20T10:00:00+0000",
          permalink_url: "https://facebook.com/post-1",
          full_picture: "https://cdn/pic.jpg",
          comments: { summary: { total_count: 12 } },
        },
      ],
    });
    const media = await getUserMedia({ context, limit: 5 });
    expect(media[0]).toMatchObject({
      id: "post-1",
      caption: "legenda",
      media_type: "IMAGE",
      timestamp: "2026-10-20T10:00:00+0000",
      permalink: "https://facebook.com/post-1",
      thumbnail_url: "https://cdn/pic.jpg",
      comments_count: 12,
    });
    expect(lastCall().url.pathname).toMatch(/\/page-1\/published_posts$/);
  });

  it("describes the Page as the account", async () => {
    respond({ id: "page-1", name: "Minha Página", followers_count: 1500 });
    expect(await getUserInfo({ context })).toEqual({
      id: "page-1",
      user_id: "page-1",
      username: "Minha Página",
      name: "Minha Página",
      followers_count: 1500,
    });
  });

  it("maps Messenger conversations with participant names as usernames", async () => {
    respond({
      data: [
        {
          id: "t1",
          updated_time: "2026-10-21T12:00:00+0000",
          participants: { data: [{ id: "psid-7", name: "Ana" }, { id: "page-1", name: "Página" }] },
          messages: { data: [{ id: "m1", message: "oi", from: { id: "psid-7", name: "Ana" } }] },
        },
      ],
    });
    const conversations = await getConversations({ context, igUserId: "page-1" });
    expect(conversations[0].participants?.data[0]).toEqual({ id: "psid-7", username: "Ana" });
    expect(conversations[0].messages?.data[0].from).toEqual({ id: "psid-7", username: "Ana" });
    expect(lastCall().url.searchParams.get("platform")).toBe("messenger");
  });

  it("reports unsupported analytics explicitly without calling Meta", async () => {
    expect(await getUserFollowStatus({ context, recipientId: "psid-7" })).toBeNull();
    expect(await getFollowerCountSeries({ context, igUserId: "page-1" })).toBeNull();
    await expect(
      getMediaInsights({ context, mediaId: "post-1", metrics: ["views"] })
    ).rejects.toBeInstanceOf(PermissionError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("declares Page capabilities so the UI and crons can hide what does not apply", () => {
    expect(providerCapabilities("FACEBOOK_PAGE")).toEqual({
      followGate: false,
      mediaInsights: false,
      followerHistory: false,
      nextReel: false,
      tokenRefresh: false,
    });
    expect(providerCapabilities("META").followGate).toBe(true);
  });
});
