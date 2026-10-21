/**
 * BullMQ Queue Client
 *
 * Provides the DM processing queue and Redis connection for BullMQ.
 */

import { Queue, type DefaultJobOptions } from "bullmq";
import Redis from "ioredis";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null, // Required by BullMQ
    });
  }
  return connection;
}

// ─── DM Queue ───────────────────────────────────────────────────────────────────

export type CommentSource = "WEBHOOK" | "POLLING";

export interface ProcessCommentJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  // Set when the comment came from an ad: the organic post the ad was made
  // from. Campaigns are bound to that post, so both ids have to be matched.
  originalMediaId?: string;
  requeueAttempt?: number;
  // Which path enqueued this comment. It is not copied to ProcessedComment or
  // used for reconciliation dedup.
  source?: CommentSource;
}

// Delivered when a user taps an opening DM's button — carries the reveal target.
export interface ProcessPostbackJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
  fallback?: boolean;
  // Set on the delayed second pass of a follow-gate check. Instagram does not
  // report a brand-new follow immediately, so the first `false` is re-checked
  // later instead of rejecting the tap outright.
  followRecheck?: boolean;
  // How many delayed re-checks have run, counting this one. Absent on jobs
  // queued before re-checks were counted, where `followRecheck` meant one.
  followRecheckAttempt?: number;
}

// Scheduled after the link is delivered, to send the appreciation follow-up.
// Enqueued with a delay (followUpDelayMinutes) so it can fire later, not just
// immediately.
export interface ProcessFollowUpJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  userId: string;
  automationId: string;
  commenterName?: string | null;
}

// An inbound DM from a user. Campaigns with `dmTriggerEnabled` whose keywords
// match the text reply to the sender.
export interface ProcessMessageJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  messageId: string;
  messageText: string;
  senderId: string;
}

export type DmQueueJob =
  | ProcessCommentJob
  | ProcessPostbackJob
  | ProcessFollowUpJob
  | ProcessMessageJob;

export const POSTBACK_JOB_NAME = "process-postback";
export const FOLLOWUP_JOB_NAME = "process-followup";
export const MESSAGE_JOB_NAME = "process-message";

const DM_QUEUE_NAME = "dm-processing";

const DM_JOB_OPTIONS: DefaultJobOptions = {
  removeOnComplete: { count: 1000 }, // Keep last 1000 completed jobs
  // Clear failed jobs shortly after they exhaust retries. Job ids are
  // deterministic (comment_<acct>_<id>), so a retained failed job would
  // block the polling reconciler from ever retrying that comment. Clearing
  // them lets a later sweep re-enqueue and try again once a transient
  // failure (e.g. an Instagram rate-limit window) has passed. Failure
  // detail is still preserved in DmLog.
  removeOnFail: { age: 300, count: 2000 },
  attempts: 3,
  backoff: {
    type: "custom",
  },
};

let dmQueue: Queue<DmQueueJob> | null = null;

export function getDMQueue(): Queue<DmQueueJob> {
  if (!dmQueue) {
    dmQueue = new Queue<DmQueueJob>(DM_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: DM_JOB_OPTIONS,
    });
  }
  return dmQueue;
}

// ─── Webhook producer ───────────────────────────────────────────────────────────

let webhookConnection: Redis | null = null;
let webhookQueue: Queue<DmQueueJob> | null = null;

/**
 * The same queue, on a connection of its own for the webhook route. The shared
 * connection waits forever for Redis (maxRetriesPerRequest: null, which the
 * worker needs), so an outage would hang the route until the function timed
 * out. This one fails fast instead; the caller still bounds the wait, because
 * BullMQ itself waits for the connection to become ready.
 */
export function getWebhookQueue(): Queue<DmQueueJob> {
  if (!webhookQueue) {
    webhookConnection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
    });
    // Without a listener ioredis reports every failed reconnect as unhandled.
    webhookConnection.on("error", () => {});
    webhookQueue = new Queue<DmQueueJob>(DM_QUEUE_NAME, {
      connection: webhookConnection,
      defaultJobOptions: DM_JOB_OPTIONS,
    });
    // One line per failed attempt instead of BullMQ's default stack trace.
    webhookQueue.on("error", (error) =>
      console.error("[Webhook queue] Redis error:", error.message)
    );
  }
  return webhookQueue;
}

/**
 * Drops the webhook producer after an enqueue timed out. Disconnecting stops
 * ioredis from reconnecting, so an add still waiting for Redis never lands
 * later behind the replay, and the next request starts from a fresh connection.
 */
export function resetWebhookQueue(): void {
  webhookConnection?.disconnect();
  webhookConnection = null;
  webhookQueue = null;
}
