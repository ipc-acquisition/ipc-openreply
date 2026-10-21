/**
 * Facebook Pages client: Messenger (private replies, DMs) and Page comments
 * (public replies, moderation) over graph.facebook.com with a Page token.
 *
 * Mirrors lib/meta/client.ts (Instagram) but keeps the two apart: the Page
 * surface is different enough — comment ids, `is_hidden`, `published_posts`,
 * `messaging_type` — that sharing request builders would hide the differences
 * rather than remove them. Errors go through the same handleResponse so the
 * worker's TokenExpiredError / RateLimitError / PermissionError handling applies
 * to Pages unchanged.
 *
 * The token is always sent in the Authorization header, never in the query
 * string, so it cannot end up in error messages or request logs.
 */
import { facebookGraphBase, handleResponse, MetaApiError } from "@/lib/meta/client";

const REQUEST_TIMEOUT_MS = 15_000;

/** Webhook fields a Page must be subscribed to for the product to work. */
export const PAGE_WEBHOOK_FIELDS = [
  "feed",
  "messages",
  "messaging_postbacks",
  "message_reads",
  "message_echoes",
] as const;

/** Page tasks the system user needs so the Page can be connected. */
export const REQUIRED_PAGE_TASKS = ["MESSAGING", "MODERATE"] as const;

// Meta returns this subcode when asking to hide a comment that is already
// hidden (observed on 2026-10-21: code=1, "already marked as spam"). The state
// we asked for is the state we got, so it is a success for our purposes.
export const COMMENT_ALREADY_HIDDEN_SUBCODE = 1446036;

export interface FacebookSystemUser {
  id: string;
  name?: string;
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
}

export interface FacebookPageInfo {
  id: string;
  name: string;
  followers_count?: number;
  fan_count?: number;
}

export interface PagePost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  comments?: { summary?: { total_count?: number } };
}

export interface PageComment {
  id: string;
  message?: string;
  // Absent for commenters who have no role on the app (Standard Access).
  from?: { id: string; name?: string };
  created_time: string;
  is_hidden?: boolean;
  can_hide?: boolean;
  // Replies, requested as comments{from} so the caller can tell whether the
  // Page itself has already answered.
  comments?: { data?: { id: string; from?: { id: string; name?: string } }[] };
}

export interface PageParticipant {
  id: string;
  name?: string;
  email?: string;
}

export interface PageMessage {
  id: string;
  created_time?: string;
  message?: string;
  from?: PageParticipant;
  to?: { data: PageParticipant[] };
}

export interface PageConversation {
  id: string;
  updated_time?: string;
  participants?: { data: PageParticipant[] };
  messages?: { data: PageMessage[] };
}

export interface SendResult {
  recipient_id: string;
  message_id: string;
}

export interface LinkButton {
  title: string;
  url: string;
}

function graphUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${facebookGraphBase()}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function graphGet<T>(accessToken: string, path: string, params?: Record<string, string>) {
  const response = await fetch(graphUrl(path, params).toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return handleResponse<T>(response);
}

async function graphPost<T>(accessToken: string, path: string, body: unknown) {
  const response = await fetch(graphUrl(path).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return handleResponse<T>(response);
}

async function graphDelete<T>(accessToken: string, path: string) {
  const response = await fetch(graphUrl(path).toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return handleResponse<T>(response);
}

// --- System user and Pages -------------------------------------------------

/** Validates a system user token by reading the user behind it. */
export async function getSystemUser(systemUserToken: string): Promise<FacebookSystemUser> {
  return graphGet<FacebookSystemUser>(systemUserToken, "me", { fields: "id,name" });
}

/**
 * The Pages assigned to the system user, each with its own Page token. Pages
 * are read through the cursor only — Meta's `paging.next` is never followed,
 * so every request stays on our host with the token in the header.
 */
export async function listSystemUserPages(systemUserToken: string): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = [];
  const seenCursors = new Set<string>();
  let after: string | undefined;

  for (let i = 0; i < 20; i++) {
    const page = await graphGet<{
      data?: FacebookPage[];
      paging?: { next?: string; cursors?: { after?: string } };
    }>(systemUserToken, "me/accounts", {
      fields: "id,name,tasks,access_token",
      limit: "100",
      ...(after ? { after } : {}),
    });
    pages.push(...(page.data ?? []));
    const next = page.paging?.cursors?.after;
    if (!page.paging?.next || !next || seenCursors.has(next)) return pages;
    seenCursors.add(next);
    after = next;
  }
  return pages;
}

export function hasRequiredPageTasks(page: Pick<FacebookPage, "tasks">) {
  const tasks = new Set(page.tasks ?? []);
  return REQUIRED_PAGE_TASKS.every((task) => tasks.has(task));
}

export async function getPageInfo(pageToken: string, pageId: string): Promise<FacebookPageInfo> {
  return graphGet<FacebookPageInfo>(pageToken, pageId, {
    fields: "id,name,followers_count,fan_count",
  });
}

export async function subscribePageToWebhooks(
  pageId: string,
  pageToken: string
): Promise<{ success: boolean }> {
  return graphPost(pageToken, `${pageId}/subscribed_apps`, {
    subscribed_fields: [...PAGE_WEBHOOK_FIELDS],
  });
}

export async function unsubscribePageFromWebhooks(
  pageId: string,
  pageToken: string
): Promise<{ success: boolean }> {
  return graphDelete(pageToken, `${pageId}/subscribed_apps`);
}

// --- Messenger: private replies and DMs -------------------------------------

function buttonTemplate(text: string, buttons: unknown[]) {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        // Button template text is capped at 640 chars by Meta.
        text: text.slice(0, 640),
        buttons,
      },
    },
  };
}

function postbackButton(title: string, payload: string) {
  return { type: "postback", title: title.slice(0, 20), payload };
}

function webUrlButtons(buttons: LinkButton[]) {
  return buttons
    .slice(0, 3)
    .map((b) => ({ type: "web_url", url: b.url, title: b.title.slice(0, 20) }));
}

/**
 * One private reply per comment, within 7 days of the comment. The returned
 * `recipient_id` is the commenter's PSID — on Pages this is the only reliable
 * way to get it, since the comment itself may carry no `from`.
 */
export async function sendPagePrivateReply(
  pageToken: string,
  pageId: string,
  commentId: string,
  text: string
): Promise<SendResult> {
  return graphPost(pageToken, `${pageId}/messages`, {
    recipient: { comment_id: commentId },
    message: { text },
  });
}

export async function sendPagePrivateReplyWithButton(
  pageToken: string,
  pageId: string,
  commentId: string,
  text: string,
  buttonTitle: string,
  payload: string
): Promise<SendResult> {
  return graphPost(pageToken, `${pageId}/messages`, {
    recipient: { comment_id: commentId },
    message: buttonTemplate(text, [postbackButton(buttonTitle, payload)]),
  });
}

export async function sendPagePrivateReplyWithLinkButtons(
  pageToken: string,
  pageId: string,
  commentId: string,
  text: string,
  buttons: LinkButton[]
): Promise<SendResult> {
  return graphPost(pageToken, `${pageId}/messages`, {
    recipient: { comment_id: commentId },
    message: buttonTemplate(text, webUrlButtons(buttons)),
  });
}

/**
 * A message to a PSID inside the 24-hour window opened by the person's last
 * message. `messaging_type: RESPONSE` is what the Send API expects here; Meta
 * rejects the call outside the window, which the worker treats as a skip.
 */
export async function sendPageMessage(
  pageToken: string,
  pageId: string,
  psid: string,
  text: string
): Promise<SendResult> {
  return graphPost(pageToken, `${pageId}/messages`, {
    recipient: { id: psid },
    messaging_type: "RESPONSE",
    message: { text },
  });
}

export async function sendPageMessageWithButton(
  pageToken: string,
  pageId: string,
  psid: string,
  text: string,
  buttonTitle: string,
  payload: string
): Promise<SendResult> {
  return graphPost(pageToken, `${pageId}/messages`, {
    recipient: { id: psid },
    messaging_type: "RESPONSE",
    message: buttonTemplate(text, [postbackButton(buttonTitle, payload)]),
  });
}

export async function sendPageMessageWithLinkButtons(
  pageToken: string,
  pageId: string,
  psid: string,
  text: string,
  buttons: LinkButton[]
): Promise<SendResult> {
  return graphPost(pageToken, `${pageId}/messages`, {
    recipient: { id: psid },
    messaging_type: "RESPONSE",
    message: buttonTemplate(text, webUrlButtons(buttons)),
  });
}

// --- Comments: public replies and moderation --------------------------------

export async function sendPageCommentReply(
  pageToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  return graphPost(pageToken, `${commentId}/comments`, { message });
}

/**
 * Hide or unhide a comment. Already being in the requested state is reported
 * by Meta as an error (see COMMENT_ALREADY_HIDDEN_SUBCODE) and returned here
 * as success, so moderation retries are idempotent.
 */
export async function setPageCommentHidden(
  pageToken: string,
  commentId: string,
  hidden: boolean
): Promise<{ success: boolean }> {
  try {
    return await graphPost(pageToken, commentId, { is_hidden: hidden });
  } catch (error) {
    if (error instanceof MetaApiError && error.subcode === COMMENT_ALREADY_HIDDEN_SUBCODE) {
      return { success: true };
    }
    throw error;
  }
}

export async function deletePageComment(
  pageToken: string,
  commentId: string
): Promise<{ success: boolean }> {
  return graphDelete(pageToken, commentId);
}

export async function getPageComment(pageToken: string, commentId: string): Promise<PageComment> {
  return graphGet<PageComment>(pageToken, commentId, {
    fields: "id,message,from,created_time,is_hidden,can_hide",
  });
}

// --- Reading posts, comments and conversations ------------------------------

const POST_FIELDS =
  "id,message,created_time,permalink_url,full_picture,comments.summary(true).limit(0)";

/** The Page's own published posts, newest first. `/feed` would include visitor posts. */
export async function getPagePublishedPosts(
  pageToken: string,
  pageId: string,
  limit = 25
): Promise<PagePost[]> {
  const data = await graphGet<{ data?: PagePost[] }>(pageToken, `${pageId}/published_posts`, {
    fields: POST_FIELDS,
    limit: String(Math.min(limit, 100)),
  });
  return data.data ?? [];
}

/**
 * Recent comments on a post, newest first, with replies so the caller can tell
 * whether the Page already answered. Stops paging once it reaches comments
 * older than `sinceMs` or the `max` ceiling — same contract as the Instagram
 * getRecentMediaComments, which the polling reconciler relies on.
 */
export async function getRecentPagePostComments(
  pageToken: string,
  postId: string,
  sinceMs: number,
  max = 800
): Promise<PageComment[]> {
  const results: PageComment[] = [];
  const seenCursors = new Set<string>();
  let after: string | undefined;

  while (results.length < max) {
    const page = await graphGet<{
      data?: PageComment[];
      paging?: { next?: string; cursors?: { after?: string } };
    }>(pageToken, `${postId}/comments`, {
      fields: "id,message,from,created_time,is_hidden,comments{from}",
      order: "reverse_chronological",
      limit: "50",
      ...(after ? { after } : {}),
    });
    const data = page.data ?? [];
    results.push(...data);

    const oldest = data[data.length - 1];
    if (!oldest || (oldest.created_time && Date.parse(oldest.created_time) < sinceMs)) break;
    const next = page.paging?.cursors?.after;
    if (!page.paging?.next || !next || seenCursors.has(next)) break;
    seenCursors.add(next);
    after = next;
  }

  return results
    .filter((c) => !c.created_time || Date.parse(c.created_time) >= sinceMs)
    .slice(0, max);
}

/** Up to 50 recent Messenger conversations with the last message as preview. */
export async function getPageConversations(
  pageToken: string,
  pageId: string
): Promise<PageConversation[]> {
  const data = await graphGet<{ data?: PageConversation[] }>(pageToken, `${pageId}/conversations`, {
    platform: "messenger",
    fields: "participants,updated_time,messages.limit(1){message,from,created_time}",
    limit: "50",
  });
  return data.data ?? [];
}

export async function getPageConversationMessages(
  pageToken: string,
  conversationId: string
): Promise<PageMessage[]> {
  const data = await graphGet<{ messages?: { data: PageMessage[] } }>(pageToken, conversationId, {
    fields: "messages{id,created_time,from,to,message}",
  });
  return data.messages?.data ?? [];
}
