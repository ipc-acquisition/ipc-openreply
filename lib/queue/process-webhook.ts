import { prisma } from '@/lib/db/client';
import { markFlowReads } from '@/lib/flows/engine';
import {
  getDMQueue,
  getWebhookQueue,
  resetWebhookQueue,
  MESSAGE_JOB_NAME,
  POSTBACK_JOB_NAME,
  type DmQueueJob,
} from '@/lib/queue/client';
import type { Queue } from 'bullmq';
import { parseCommentEvents, parseMessageEvents, parsePostbackEvents, parseReadEvents, webhookProvider } from '@/lib/meta/webhook';
import { Prisma, type InstagramProvider } from '@/app/generated/prisma/client';

const OPENING_DM_READ_FALLBACK_DELAY_MS = 5 * 60 * 1000;
type InstagramPayload = Parameters<typeof parseCommentEvents>[0];
type WebhookQueue = Pick<Queue<DmQueueJob>, 'add'>;
type AccountMap = Map<string, { id: string; instagramId: string; workspaceId: string }>;

// How long the webhook route waits for Redis before answering Meta anyway. The
// payload is already in WebhookEvent, so the worker replays it later.
export const WEBHOOK_ENQUEUE_TIMEOUT_MS = Number(process.env.WEBHOOK_ENQUEUE_TIMEOUT_MS ?? 5_000);
// Events older than this are not replayed: a Messenger reply that late falls
// outside the 24h window, and comments are covered by the polling reconciler.
export const WEBHOOK_REPLAY_WINDOW_MS = Number(process.env.WEBHOOK_REPLAY_WINDOW_HOURS ?? 24) * 60 * 60 * 1000;
// A PENDING row this old was left by a request that died mid-enqueue (older
// code hung on Redis until the function was killed).
const STALE_PENDING_MS = 5 * 60 * 1000;
const REPLAY_BATCH_SIZE = 100;

export class WebhookEnqueueTimeoutError extends Error {
  constructor(ms: number) {
    super(`Enqueue timed out after ${ms}ms`);
    this.name = 'WebhookEnqueueTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // The losing promise may still reject later; that must not surface as an
  // unhandled rejection.
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WebhookEnqueueTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function findWebhookAccounts(payload: InstagramPayload, provider: InstagramProvider, workspaceId?: string): Promise<AccountMap> {
  const accounts = await prisma.instagramAccount.findMany({
    where: { instagramId: { in: payload.entry.map(e => e.id) }, provider, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true, instagramId: true, workspaceId: true },
  });
  return new Map(accounts.map(a => [a.instagramId, a]));
}

export async function processInstagramWebhook({ payload: incoming, provider, workspaceId }: {
  payload: InstagramPayload; provider: InstagramProvider; workspaceId?: string;
}) {
  // "instagram" and "page" share the envelope; the parsers tell them apart.
  if (!webhookProvider(incoming.object) || !Array.isArray(incoming.entry)) return;
  const accountMap = await findWebhookAccounts(incoming, provider, workspaceId);
  const payload = { ...incoming, entry: incoming.entry.filter(e => accountMap.has(e.id)) };
  if (!payload.entry.length) return;
  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      object:
        typeof payload === "object" && payload && "object" in payload
          ? String(payload.object)
          : null,
      payload: payload as unknown as Prisma.InputJsonValue,
      provider,
      ...(workspaceId ? { workspaceId } : {}),
      status: "PENDING",
    },
  });

  // Never throws for a Redis failure: the payload is persisted, so Meta gets
  // its 200 and the worker replays the event once Redis is back.
  const enqueued = await dispatchWebhookEvent({
    eventId: webhookEvent.id,
    payload,
    accountMap,
    queue: getWebhookQueue(),
    timeoutMs: WEBHOOK_ENQUEUE_TIMEOUT_MS,
  });
  if (!enqueued) resetWebhookQueue();
}

/**
 * Enqueues every job a stored webhook payload produces and records the outcome
 * on its WebhookEvent: PROCESSED, or NOT_ENQUEUED for the replay to pick up.
 * Job ids are deterministic and the worker claims each delivery before calling
 * Meta, so enqueueing the same payload twice cannot send anything twice.
 */
async function dispatchWebhookEvent({ eventId, payload, accountMap, queue, timeoutMs }: {
  eventId: string; payload: InstagramPayload; accountMap: AccountMap; queue: WebhookQueue; timeoutMs: number;
}): Promise<boolean> {
  try {
    await withTimeout(enqueueWebhookJobs({ eventId, payload, accountMap, queue }), timeoutMs);
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: "PROCESSED",
        errorMessage: null,
        processedAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Webhook] Event ${eventId} not enqueued:`, message);
    // If this write fails too the row stays PENDING, which the replay also
    // picks up once it is stale.
    await prisma.webhookEvent
      .update({
        where: { id: eventId },
        data: {
          status: "NOT_ENQUEUED",
          errorMessage: message,
          processedAt: new Date(),
        },
      })
      .catch(() => {});
    return false;
  }
}

async function enqueueWebhookJobs({ eventId, payload, accountMap, queue }: {
  eventId: string; payload: InstagramPayload; accountMap: AccountMap; queue: WebhookQueue;
}): Promise<void> {
  const commentEvents = parseCommentEvents(payload);

  for (const event of commentEvents) {
    const account = accountMap.get(event.instagramAccountId);
    if (!account) continue;

    await queue.add(
      "process-comment",
      {
        instagramAccountId: event.instagramAccountId,
        accountConnectionId: accountMap.get(event.instagramAccountId)?.id,
        commentId: event.commentId,
        commentText: event.commentText,
        commenterId: event.commenterId,
        commenterName: event.commenterName,
        mediaId: event.mediaId,
        originalMediaId: event.originalMediaId,
        source: "WEBHOOK",
      },
      {
        jobId: `comment_${event.instagramAccountId}_${event.commentId}`,
      }
    );

    if (account) {
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { workspaceId: account.workspaceId },
      });
    }
  }

  // Button taps from opening DMs → deliver the reveal message.
  const postbackEvents = parsePostbackEvents(payload);

  for (const event of postbackEvents) {
    await queue.add(
      POSTBACK_JOB_NAME,
      {
        instagramAccountId: event.instagramAccountId,
        accountConnectionId: accountMap.get(event.instagramAccountId)?.id,
        userId: event.userId,
        payload: event.payload,
        mid: event.mid,
      },
      {
        // BullMQ forbids ":" in custom job ids, and the payload is
        // "reveal:<id>", so build with underscores and strip any colons.
        jobId: `postback_${event.instagramAccountId}_${event.userId}_${(
          event.mid ?? event.payload
        ).replace(/:/g, "_")}`,
      }
    );
  }

  // Inbound DMs → keyword-triggered autoreply.
  const messageEvents = parseMessageEvents(payload);

  for (const event of messageEvents) {
    const account = accountMap.get(event.instagramAccountId);
    if (!account) continue;

    await queue.add(
      MESSAGE_JOB_NAME,
      {
        instagramAccountId: event.instagramAccountId,
        accountConnectionId: accountMap.get(event.instagramAccountId)?.id,
        messageId: event.messageId,
        messageText: event.messageText,
        senderId: event.senderId,
      },
      {
        // Message ids can contain characters BullMQ rejects in a job id (":"
        // in particular). base64url encodes into exactly the allowed alphabet
        // and stays injective — substituting invalid characters would let two
        // distinct mids collapse onto one job id, silently dropping a reply.
        jobId: `message_${event.instagramAccountId}_${Buffer.from(
          event.messageId
        ).toString("base64url")}`,
      }
    );

    if (account) {
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { workspaceId: account.workspaceId },
      });
    }
  }

  // If a user reads the opening DM and never taps the button, deliver the
  // same next-step DM after five minutes. The worker no-ops this delayed job
  // if a real button tap has already delivered the reveal.
  const readEvents = parseReadEvents(payload);

  for (const event of readEvents) {
    // Flow "opened" numbers: everything sent before the watermark was read.
    if (typeof event.watermark === "number") {
      try {
        await markFlowReads({
          accountConnectionId: accountMap.get(event.instagramAccountId)?.id,
          instagramAccountId: event.instagramAccountId,
          psid: event.userId,
          watermark: event.watermark,
        });
      } catch (error) {
        console.log("[Flows] Read receipt handling failed:", error instanceof Error ? error.message : error);
      }
    }

    const openingLogs = await prisma.dmLog.findMany({
      where: {
        // Reads carry the person's messaging id; on Pages that is the PSID
        // stored as recipientId, not the comment author's id.
        OR: [{ commenterId: event.userId }, { recipientId: event.userId }],
        status: "SENT",
        automation: {
          isActive: true,
          openingDmEnabled: true,
          instagramAccount: {
            instagramId: event.instagramAccountId,
          },
        },
      },
      select: {
        automation: {
          select: {
            id: true,
          },
        },
      },
    });

    const scheduledAutomationIds = new Set<string>();
    for (const log of openingLogs) {
      const automation = log.automation;
      if (scheduledAutomationIds.has(automation.id)) continue;
      scheduledAutomationIds.add(automation.id);

      await queue.add(
        POSTBACK_JOB_NAME,
        {
          instagramAccountId: event.instagramAccountId,
          accountConnectionId: accountMap.get(event.instagramAccountId)?.id,
          userId: event.userId,
          payload: `reveal:${automation.id}`,
          fallback: true,
        },
        {
          delay: OPENING_DM_READ_FALLBACK_DELAY_MS,
          jobId: `read_fallback_${event.instagramAccountId}_${event.userId}_${automation.id}`,
        }
      );
    }
  }
}

let replaying = false;

/**
 * Re-enqueues webhook payloads that never reached Redis: rows the route marked
 * NOT_ENQUEUED, and PENDING rows a dead request left behind. Runs in the
 * worker on boot and on each poll. Rows past the window are marked FAILED so
 * they stop being candidates and show up in diagnostics.
 */
export async function replayUnqueuedWebhookEvents({
  now = new Date(),
  queue = getDMQueue(),
  timeoutMs = WEBHOOK_ENQUEUE_TIMEOUT_MS,
}: { now?: Date; queue?: WebhookQueue; timeoutMs?: number } = {}): Promise<{ replayed: number; failed: number; expired: number }> {
  const result = { replayed: 0, failed: 0, expired: 0 };
  // Polls run on a timer; a sweep still waiting on Redis must not overlap the
  // next one.
  if (replaying) return result;
  replaying = true;
  try {
    const windowStart = new Date(now.getTime() - WEBHOOK_REPLAY_WINDOW_MS);
    const staleBefore = new Date(now.getTime() - STALE_PENDING_MS);

    const expired = await prisma.webhookEvent.updateMany({
      where: {
        createdAt: { lt: windowStart },
        OR: [{ status: "NOT_ENQUEUED" }, { status: "PENDING" }],
      },
      data: { status: "FAILED", errorMessage: "Not enqueued within the replay window", processedAt: now },
    });
    result.expired = expired.count;

    const events = await prisma.webhookEvent.findMany({
      where: {
        createdAt: { gte: windowStart },
        OR: [
          { status: "NOT_ENQUEUED" },
          { status: "PENDING", createdAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: REPLAY_BATCH_SIZE,
      select: { id: true, payload: true, provider: true },
    });

    for (const event of events) {
      const payload = event.payload as unknown as InstagramPayload;
      // Rows written before `provider` was stored: the object identifies it.
      const provider = event.provider ?? webhookProvider(payload?.object);
      if (!provider || !Array.isArray(payload?.entry)) {
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: { status: "FAILED", errorMessage: "Unreadable payload", processedAt: now },
        });
        result.failed++;
        continue;
      }
      // The payload was filtered to connected accounts when it arrived; an
      // account disconnected since then simply drops out here.
      const accountMap = await findWebhookAccounts(payload, provider);
      const enqueued = await dispatchWebhookEvent({
        eventId: event.id,
        payload: { ...payload, entry: payload.entry.filter(e => accountMap.has(e.id)) },
        accountMap,
        queue,
        timeoutMs,
      });
      if (enqueued) {
        result.replayed++;
      } else {
        result.failed++;
        // Redis is still unreachable; the rest would only time out too.
        break;
      }
    }
    return result;
  } finally {
    replaying = false;
  }
}
