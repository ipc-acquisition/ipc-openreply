import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaApiError, TokenExpiredError } from "@/lib/meta/client";
import {
  COMMENT_ALREADY_HIDDEN_SUBCODE,
  deletePageComment,
  getPagePublishedPosts,
  getRecentPagePostComments,
  hasRequiredPageTasks,
  listSystemUserPages,
  PAGE_WEBHOOK_FIELDS,
  sendPageCommentReply,
  sendPageMessage,
  sendPageMessageWithLinkButtons,
  sendPagePrivateReply,
  sendPagePrivateReplyWithButton,
  setPageCommentHidden,
  subscribePageToWebhooks,
} from "@/lib/meta/page-client";

const token = "page-token-not-for-logging";
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const failure = (code: number, error_subcode?: number) =>
  new Response(
    JSON.stringify({
      error: { code, error_subcode, type: "OAuthException", message: "nope", fbtrace_id: "t" },
    }),
    { status: 400 }
  );

type Call = { url: URL; init: RequestInit; body: Record<string, unknown> | null };

/** Stub fetch with a queue of responses and record every request. */
function installGraph(responses: Response[]) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      url,
      init: init ?? {},
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("page-client requests", () => {
  it("sends every request to graph.facebook.com with the token in the header only", async () => {
    const { calls } = installGraph([ok({ recipient_id: "psid", message_id: "mid" })]);
    await sendPagePrivateReply(token, "page1", "c1", "hi");
    const [call] = calls;
    expect(call.url.origin).toBe("https://graph.facebook.com");
    expect(call.url.pathname).toMatch(/^\/v\d+\.\d+\/page1\/messages$/);
    expect(call.url.searchParams.has("access_token")).toBe(false);
    expect(new Headers(call.init.headers).get("Authorization")).toBe(`Bearer ${token}`);
    expect(call.url.toString()).not.toContain(token);
  });

  it("private reply targets the comment and returns the commenter's PSID", async () => {
    const { calls } = installGraph([ok({ recipient_id: "psid-42", message_id: "m_1" })]);
    const result = await sendPagePrivateReply(token, "page1", "comment_9", "olá");
    expect(result).toEqual({ recipient_id: "psid-42", message_id: "m_1" });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].body).toEqual({
      recipient: { comment_id: "comment_9" },
      message: { text: "olá" },
    });
    // Private replies carry no messaging_type: they are not inside a window.
    expect(calls[0].body).not.toHaveProperty("messaging_type");
  });

  it("private reply with a postback button uses the button template", async () => {
    const { calls } = installGraph([ok({ recipient_id: "p", message_id: "m" })]);
    await sendPagePrivateReplyWithButton(
      token,
      "page1",
      "c1",
      "x".repeat(700),
      "a very long button title here",
      "reveal:auto1:open"
    );
    const message = calls[0].body?.message as {
      attachment: { type: string; payload: { template_type: string; text: string; buttons: unknown[] } };
    };
    expect(message.attachment.type).toBe("template");
    expect(message.attachment.payload.template_type).toBe("button");
    expect(message.attachment.payload.text).toHaveLength(640);
    expect(message.attachment.payload.buttons).toEqual([
      { type: "postback", title: "a very long button t", payload: "reveal:auto1:open" },
    ]);
  });

  it("DM by PSID is sent as a RESPONSE inside the 24h window", async () => {
    const { calls } = installGraph([ok({ recipient_id: "psid-1", message_id: "m" })]);
    await sendPageMessage(token, "page1", "psid-1", "segue o link");
    expect(calls[0].body).toEqual({
      recipient: { id: "psid-1" },
      messaging_type: "RESPONSE",
      message: { text: "segue o link" },
    });
  });

  it("link buttons become web_url buttons, at most three", async () => {
    const { calls } = installGraph([ok({ recipient_id: "p", message_id: "m" })]);
    await sendPageMessageWithLinkButtons(token, "page1", "psid-1", "links", [
      { title: "um", url: "https://a.test/1" },
      { title: "dois", url: "https://a.test/2" },
      { title: "três", url: "https://a.test/3" },
      { title: "quatro", url: "https://a.test/4" },
    ]);
    const payload = (calls[0].body?.message as { attachment: { payload: { buttons: unknown[] } } })
      .attachment.payload;
    expect(payload.buttons).toEqual([
      { type: "web_url", url: "https://a.test/1", title: "um" },
      { type: "web_url", url: "https://a.test/2", title: "dois" },
      { type: "web_url", url: "https://a.test/3", title: "três" },
    ]);
  });

  it("public reply posts to the comment's comments edge", async () => {
    const { calls } = installGraph([ok({ id: "c1_reply" })]);
    const result = await sendPageCommentReply(token, "c1", "obrigado!");
    expect(result).toEqual({ id: "c1_reply" });
    expect(calls[0].url.pathname).toMatch(/\/c1\/comments$/);
    expect(calls[0].body).toEqual({ message: "obrigado!" });
  });

  it("subscribes the Page to exactly the webhook fields the product needs", async () => {
    const { calls } = installGraph([ok({ success: true })]);
    await subscribePageToWebhooks("page1", token);
    expect(calls[0].url.pathname).toMatch(/\/page1\/subscribed_apps$/);
    expect(calls[0].body).toEqual({
      subscribed_fields: ["feed", "messages", "messaging_postbacks", "message_reads", "message_echoes"],
    });
    expect(PAGE_WEBHOOK_FIELDS).toHaveLength(5);
  });

  it("reads the Page's own published posts, not the visitor feed", async () => {
    const { calls } = installGraph([ok({ data: [{ id: "p1", created_time: "2026-10-21T00:00:00+0000" }] })]);
    const posts = await getPagePublishedPosts(token, "page1", 10);
    expect(posts).toHaveLength(1);
    expect(calls[0].url.pathname).toMatch(/\/page1\/published_posts$/);
    expect(calls[0].url.searchParams.get("limit")).toBe("10");
    expect(calls[0].url.searchParams.get("fields")).toContain("permalink_url");
  });
});

describe("comment moderation", () => {
  it("hides a comment with is_hidden=true", async () => {
    const { calls } = installGraph([ok({ success: true })]);
    const result = await setPageCommentHidden(token, "c1", true);
    expect(result).toEqual({ success: true });
    expect(calls[0].url.pathname).toMatch(/\/c1$/);
    expect(calls[0].body).toEqual({ is_hidden: true });
  });

  it(`treats subcode ${COMMENT_ALREADY_HIDDEN_SUBCODE} (already hidden) as success`, async () => {
    installGraph([failure(1, COMMENT_ALREADY_HIDDEN_SUBCODE)]);
    await expect(setPageCommentHidden(token, "c1", true)).resolves.toEqual({ success: true });
  });

  it("still surfaces other errors when hiding", async () => {
    installGraph([failure(190)]);
    await expect(setPageCommentHidden(token, "c1", true)).rejects.toBeInstanceOf(TokenExpiredError);
    installGraph([failure(1, 999)]);
    await expect(setPageCommentHidden(token, "c1", false)).rejects.toBeInstanceOf(MetaApiError);
  });

  it("deletes with the DELETE verb", async () => {
    const { calls } = installGraph([ok({ success: true })]);
    await deletePageComment(token, "c1");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url.pathname).toMatch(/\/c1$/);
  });
});

describe("system user pages", () => {
  it("follows the cursor and never Meta's next URL", async () => {
    const { calls } = installGraph([
      ok({
        data: [{ id: "1", name: "A", access_token: "ta", tasks: ["MESSAGING", "MODERATE"] }],
        paging: { next: "https://untrusted.example/never", cursors: { after: "cur-1" } },
      }),
      ok({ data: [{ id: "2", name: "B", access_token: "tb", tasks: ["ANALYZE"] }] }),
    ]);
    const pages = await listSystemUserPages("sys-token");
    expect(pages.map((p) => p.id)).toEqual(["1", "2"]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url.pathname).toMatch(/\/me\/accounts$/);
    expect(calls[0].url.searchParams.get("fields")).toBe("id,name,tasks,access_token");
    expect(calls[1].url.origin).toBe("https://graph.facebook.com");
    expect(calls[1].url.searchParams.get("after")).toBe("cur-1");
    expect(hasRequiredPageTasks(pages[0])).toBe(true);
    expect(hasRequiredPageTasks(pages[1])).toBe(false);
  });
});

describe("recent post comments", () => {
  it("stops paging once comments predate the window and drops the old ones", async () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const sinceMs = now - 60 * 60 * 1000;
    const iso = (offsetMin: number) => new Date(now - offsetMin * 60_000).toISOString();
    const { calls } = installGraph([
      ok({
        data: [
          { id: "new", created_time: iso(5), message: "x" },
          { id: "old", created_time: iso(120), message: "y" },
        ],
        paging: { next: "https://untrusted.example/never", cursors: { after: "c2" } },
      }),
    ]);
    const comments = await getRecentPagePostComments(token, "post1", sinceMs);
    expect(comments.map((c) => c.id)).toEqual(["new"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.searchParams.get("order")).toBe("reverse_chronological");
    expect(calls[0].url.searchParams.get("fields")).toContain("comments{from}");
  });
});
