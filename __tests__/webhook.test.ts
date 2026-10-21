/**
 * Webhook — Unit Tests
 *
 * Tests signature verification and comment event parsing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifyWebhookSignature,
  parseCommentEvents,
  parseMessageEvents,
  parsePostbackEvents,
  parseReadEvents,
  isUnknownCommenter,
  unknownCommenterId,
  webhookProvider,
} from "../lib/meta/webhook";
import { createHmac } from "crypto";

// Mock the environment variable
beforeEach(() => {
  vi.stubEnv("FACEBOOK_APP_SECRET", "test_app_secret_12345");
});

describe("verifyWebhookSignature", () => {
  function createSignature(payload: string, secret: string): string {
    return (
      "sha256=" + createHmac("sha256", secret).update(payload).digest("hex")
    );
  }

  it("should return true for valid signature", () => {
    const payload = '{"test": "data"}';
    const signature = createSignature(payload, "test_app_secret_12345");
    expect(verifyWebhookSignature(payload, signature)).toBe(true);
  });

  it("should return false for invalid signature", () => {
    const payload = '{"test": "data"}';
    const signature = "sha256=invalid_signature_here";
    expect(verifyWebhookSignature(payload, signature)).toBe(false);
  });

  it("should return false for null signature", () => {
    expect(verifyWebhookSignature('{"test": "data"}', null)).toBe(false);
  });

  it("should return false for empty signature", () => {
    expect(verifyWebhookSignature('{"test": "data"}', "")).toBe(false);
  });

  it("should return false when payload is tampered", () => {
    const originalPayload = '{"test": "data"}';
    const signature = createSignature(originalPayload, "test_app_secret_12345");
    const tamperedPayload = '{"test": "tampered"}';
    expect(verifyWebhookSignature(tamperedPayload, signature)).toBe(false);
  });

  it("should return false when signed with wrong secret", () => {
    const payload = '{"test": "data"}';
    const signature = createSignature(payload, "wrong_secret");
    expect(verifyWebhookSignature(payload, signature)).toBe(false);
  });
});

describe("parseCommentEvents", () => {
  it("should parse a valid comment event", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "page_123",
          time: 1234567890,
          changes: [
            {
              field: "comments",
              value: {
                id: "comment_456",
                text: "I want the LINK!",
                from: {
                  id: "user_789",
                  username: "testuser",
                },
                media: {
                  id: "media_101",
                },
              },
            },
          ],
        },
      ],
    };

    const events = parseCommentEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      instagramAccountId: "page_123",
      commentId: "comment_456",
      commentText: "I want the LINK!",
      commenterId: "user_789",
      commenterName: "testuser",
      mediaId: "media_101",
    });
  });

  it("keeps the organic post id of a comment left on an ad", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "page_123",
          time: 1234567890,
          changes: [
            {
              field: "comments",
              value: {
                id: "comment_456",
                text: "Link",
                from: { id: "user_789", username: "testuser" },
                // A boosted post: the comment carries the ad's own media id,
                // while the campaign is bound to the post it was made from.
                media: {
                  id: "ad_media_999",
                  ad_id: "ad_123",
                  original_media_id: "media_101",
                  media_product_type: "AD",
                },
              },
            },
          ],
        },
      ],
    };

    const events = parseCommentEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0].mediaId).toBe("ad_media_999");
    expect(events[0].originalMediaId).toBe("media_101");
  });

  it("leaves originalMediaId unset when it repeats the media id", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "page_123",
          time: 1234567890,
          changes: [
            {
              field: "comments",
              value: {
                id: "comment_456",
                text: "Link",
                from: { id: "user_789", username: "testuser" },
                media: { id: "media_101", original_media_id: "media_101" },
              },
            },
          ],
        },
      ],
    };

    expect(parseCommentEvents(payload)[0].originalMediaId).toBeUndefined();
  });

  it("should ignore unsupported objects", () => {
    const payload = {
      object: "user",
      entry: [
        {
          id: "page_123",
          time: 1234567890,
          changes: [
            {
              field: "comments",
              value: {
                id: "comment_456",
                text: "hello",
                from: { id: "user_789", username: "test" },
                media: { id: "media_101" },
              },
            },
          ],
        },
      ],
    };

    const events = parseCommentEvents(payload);
    expect(events).toHaveLength(0);
  });

  it("should ignore non-comment fields", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "page_123",
          time: 1234567890,
          changes: [
            {
              field: "messages",
              value: {
                id: "msg_456",
                text: "hello",
                from: { id: "user_789", username: "test" },
                media: { id: "media_101" },
              },
            },
          ],
        },
      ],
    };

    const events = parseCommentEvents(payload);
    expect(events).toHaveLength(0);
  });

  it("should handle multiple comment events in one payload", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "page_123",
          time: 1234567890,
          changes: [
            {
              field: "comments",
              value: {
                id: "comment_1",
                text: "LINK",
                from: { id: "user_1", username: "user1" },
                media: { id: "media_1" },
              },
            },
            {
              field: "comments",
              value: {
                id: "comment_2",
                text: "PRICE",
                from: { id: "user_2", username: "user2" },
                media: { id: "media_1" },
              },
            },
          ],
        },
      ],
    };

    const events = parseCommentEvents(payload);
    expect(events).toHaveLength(2);
  });

  it("should parse events with empty text so matching can decide later", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "page_123",
          time: 1234567890,
          changes: [
            {
              field: "comments",
              value: {
                id: "comment_1",
                text: "", // empty text
                from: { id: "user_1", username: "user1" },
                media: { id: "media_1" },
              },
            },
          ],
        },
      ],
    };

    const events = parseCommentEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0].commentText).toBe("");
  });

  it("should ignore comments from the connected account itself", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "page_123",
          time: 1234567890,
          changes: [
            {
              field: "comments",
              value: {
                id: "comment_1",
                text: "LINK",
                from: { id: "page_123", username: "ourbrand" },
                media: { id: "media_1" },
              },
            },
          ],
        },
      ],
    };

    expect(parseCommentEvents(payload)).toHaveLength(0);
  });

  it("should still parse other users' comments alongside a self-comment", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "page_123",
          time: 1234567890,
          changes: [
            {
              field: "comments",
              value: {
                id: "comment_1",
                text: "LINK",
                from: { id: "page_123", username: "ourbrand" },
                media: { id: "media_1" },
              },
            },
            {
              field: "comments",
              value: {
                id: "comment_2",
                text: "LINK",
                from: { id: "user_2", username: "user2" },
                media: { id: "media_1" },
              },
            },
          ],
        },
      ],
    };

    const events = parseCommentEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0].commenterId).toBe("user_2");
  });

  it("should handle entries without changes", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "page_123",
          time: 1234567890,
          // no changes field
        },
      ],
    };

    const events = parseCommentEvents(payload);
    expect(events).toHaveLength(0);
  });
});

describe("parseMessageEvents", () => {
  function messagingPayload(messaging: unknown[]) {
    return {
      object: "instagram",
      entry: [{ id: "ig_456", time: 1234567890, messaging }],
    } as Parameters<typeof parseMessageEvents>[0];
  }

  it("should parse an inbound DM", () => {
    const payload = messagingPayload([
      {
        sender: { id: "user_999" },
        recipient: { id: "ig_456" },
        message: { mid: "mid_abc", text: "send me the LINK please" },
      },
    ]);

    expect(parseMessageEvents(payload)).toEqual([
      {
        instagramAccountId: "ig_456",
        messageId: "mid_abc",
        messageText: "send me the LINK please",
        senderId: "user_999",
      },
    ]);
  });

  it("should ignore echoes of the account's own messages", () => {
    const payload = messagingPayload([
      {
        sender: { id: "ig_456" },
        recipient: { id: "user_999" },
        message: { mid: "mid_abc", text: "here's your link", is_echo: true },
      },
    ]);

    expect(parseMessageEvents(payload)).toHaveLength(0);
  });

  it("should ignore deleted and unsupported messages", () => {
    expect(
      parseMessageEvents(
        messagingPayload([
          {
            sender: { id: "user_999" },
            recipient: { id: "ig_456" },
            message: { mid: "mid_a", text: "link", is_deleted: true },
          },
          {
            sender: { id: "user_999" },
            recipient: { id: "ig_456" },
            message: { mid: "mid_b", text: "link", is_unsupported: true },
          },
        ])
      )
    ).toHaveLength(0);
  });

  it("should ignore attachment-only messages with no text", () => {
    const payload = messagingPayload([
      {
        sender: { id: "user_999" },
        recipient: { id: "ig_456" },
        message: { mid: "mid_abc", attachments: [{ type: "image" }] },
      },
    ]);

    expect(parseMessageEvents(payload)).toHaveLength(0);
  });

  it("should ignore messages the account sent to itself", () => {
    const payload = messagingPayload([
      {
        sender: { id: "ig_456" },
        recipient: { id: "ig_456" },
        message: { mid: "mid_abc", text: "link" },
      },
    ]);

    expect(parseMessageEvents(payload)).toHaveLength(0);
  });

  it("should ignore postback events that carry no message", () => {
    const payload = messagingPayload([
      {
        sender: { id: "user_999" },
        recipient: { id: "ig_456" },
        postback: { mid: "mid_abc", payload: "reveal:auto_1" },
      },
    ]);

    expect(parseMessageEvents(payload)).toHaveLength(0);
  });

  it("should ignore unsupported objects", () => {
    expect(
      parseMessageEvents({
        object: "user",
        entry: [
          {
            id: "ig_456",
            time: 1,
            messaging: [
              {
                sender: { id: "user_999" },
                message: { mid: "mid_abc", text: "link" },
              },
            ],
          },
        ],
      })
    ).toHaveLength(0);
  });
});

describe("parseReadEvents", () => {
  it("should parse Instagram DM read receipts", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "ig_456",
          time: 1234567890,
          messaging: [
            {
              sender: { id: "commenter_999" },
              recipient: { id: "ig_456" },
              read: { watermark: 1770000000000 },
            },
          ],
        },
      ],
    };

    expect(parseReadEvents(payload)).toEqual([
      {
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        watermark: 1770000000000,
      },
    ]);
  });

  it("should ignore read receipts from the connected account itself", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "ig_456",
          time: 1234567890,
          messaging: [
            {
              sender: { id: "ig_456" },
              recipient: { id: "ig_456" },
              read: { watermark: 1770000000000 },
            },
          ],
        },
      ],
    };

    expect(parseReadEvents(payload)).toHaveLength(0);
  });
});

describe("Facebook Page payloads", () => {
  const pageId = "page_100";
  function pagePayload(entry: Record<string, unknown>) {
    return {
      object: "page",
      entry: [{ id: pageId, time: 1234567890, ...entry }],
    } as Parameters<typeof parseCommentEvents>[0];
  }
  function feedComment(value: Record<string, unknown>) {
    return pagePayload({ changes: [{ field: "feed", value }] });
  }

  it("parses a new Page comment from the feed field", () => {
    expect(
      parseCommentEvents(
        feedComment({
          item: "comment",
          verb: "add",
          comment_id: "post_1_c1",
          post_id: "page_100_post_1",
          parent_id: "page_100_post_1",
          from: { id: "user_7", name: "Ana Souza" },
          message: "quero o link",
          created_time: 1234567890,
        })
      )
    ).toEqual([
      {
        instagramAccountId: pageId,
        commentId: "post_1_c1",
        commentText: "quero o link",
        commenterId: "user_7",
        commenterName: "Ana Souza",
        mediaId: "page_100_post_1",
      },
    ]);
  });

  it("keeps a comment without `from` under a sentinel commenter id", () => {
    const [event] = parseCommentEvents(
      feedComment({
        item: "comment",
        verb: "add",
        comment_id: "post_1_c2",
        post_id: "page_100_post_1",
        message: "eu também",
      })
    );
    expect(event.commenterId).toBe(unknownCommenterId("post_1_c2"));
    expect(isUnknownCommenter(event.commenterId)).toBe(true);
    expect(isUnknownCommenter("user_7")).toBe(false);
    expect(event.commenterName).toBeUndefined();
  });

  it("ignores edits, removals, hides and non-comment feed items", () => {
    for (const value of [
      { item: "comment", verb: "edited", comment_id: "c", post_id: "p", message: "x" },
      { item: "comment", verb: "remove", comment_id: "c", post_id: "p" },
      { item: "comment", verb: "hide", comment_id: "c", post_id: "p" },
      { item: "post", verb: "add", post_id: "p", message: "novo post" },
      { item: "reaction", verb: "add", post_id: "p", reaction_type: "like" },
    ]) {
      expect(parseCommentEvents(feedComment(value))).toHaveLength(0);
    }
  });

  it("ignores the Page's own comments", () => {
    expect(
      parseCommentEvents(
        feedComment({
          item: "comment",
          verb: "add",
          comment_id: "c",
          post_id: "p",
          from: { id: pageId, name: "Minha Página" },
          message: "obrigada!",
        })
      )
    ).toHaveLength(0);
  });

  it("ignores Instagram-style `comments` changes on a page object", () => {
    expect(
      parseCommentEvents(
        pagePayload({
          changes: [{ field: "comments", value: { id: "c", text: "x", from: { id: "u" }, media: { id: "m" } } }],
        })
      )
    ).toHaveLength(0);
  });

  it("parses Messenger messages, postbacks and reads with the PSID as sender", () => {
    const payload = pagePayload({
      messaging: [
        { sender: { id: "psid_1" }, recipient: { id: pageId }, message: { mid: "m_1", text: "link" } },
        { sender: { id: "psid_1" }, recipient: { id: pageId }, postback: { mid: "m_2", payload: "reveal:auto" } },
        { sender: { id: "psid_1" }, recipient: { id: pageId }, read: { watermark: 99 } },
        { sender: { id: pageId }, recipient: { id: "psid_1" }, message: { mid: "m_3", text: "eco", is_echo: true } },
      ],
    });
    expect(parseMessageEvents(payload)).toEqual([
      { instagramAccountId: pageId, messageId: "m_1", messageText: "link", senderId: "psid_1" },
    ]);
    expect(parsePostbackEvents(payload)).toEqual([
      { instagramAccountId: pageId, userId: "psid_1", payload: "reveal:auto", mid: "m_2" },
    ]);
    expect(parseReadEvents(payload)).toEqual([
      { instagramAccountId: pageId, userId: "psid_1", watermark: 99 },
    ]);
  });

  it("maps the webhook object to a provider", () => {
    expect(webhookProvider("instagram")).toBe("META");
    expect(webhookProvider("page")).toBe("FACEBOOK_PAGE");
    expect(webhookProvider("user")).toBeNull();
    expect(webhookProvider(undefined)).toBeNull();
  });
});
