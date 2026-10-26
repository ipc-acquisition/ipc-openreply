import type { Job } from "bullmq";
import { prisma } from "@/lib/db/client";
import {
  FLOW_STEP_JOB_NAME,
  getDMQueue,
  type ProcessFlowStepJob,
} from "@/lib/queue/client";
import {
  createInstagramContext,
  hasInstagramCredentials,
  isOutsideMessagingWindowError,
  MetaApiError,
  sendDirectMessage,
  sendDirectMessageWithLinkButton,
  type InstagramContext,
} from "@/lib/instagram/provider";
import {
  classifySendError,
  isConfirmedSendRejection,
} from "@/lib/instagram/delivery-errors";
import { releaseDMSlot, reserveDMSlot } from "@/lib/utils/rate-limiter";
import { hashRecipientId } from "@/lib/tracking/server";
import { buildTrackedUrl, renderMessageWithoutLink } from "@/lib/tracking/message";
import { flowMatchesMessage, isWindowOpen, matchesStopKeyword } from "./window";

/**
 * Messenger flows (drip sequences).
 *
 * Entry: every inbound DM (and every tap on a comment-to-DM button) lands in
 * handleInbound*, which refreshes the person's 24h window and enrolls them in
 * the flows that match. Each step is a delayed BullMQ job; processFlowStep
 * revalidates everything when it fires, claims the step in FlowSendLog before
 * calling Meta (docs/delivery-retries.md), sends, and schedules the next one.
 */

const OPT_OUT_CONFIRMATION =
  "Pronto, você não vai receber mais mensagens automáticas por aqui.";
const CAMPAIGN_REPLY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

type AccountRef = { accountConnectionId?: string; instagramAccountId: string };

type Account = {
  id: string;
  workspaceId: string;
  instagramId: string;
  provider: "META" | "ZERNIO" | "FACEBOOK_PAGE";
  accessToken: string;
  zernioAccountId: string | null;
};

type StepRef = { id: string; position: number; delayMinutes: number };

async function findAccount(ref: AccountRef): Promise<Account | null> {
  return prisma.instagramAccount.findFirst({
    where: ref.accountConnectionId
      ? { id: ref.accountConnectionId }
      : { instagramId: ref.instagramAccountId },
    select: {
      id: true,
      workspaceId: true,
      instagramId: true,
      provider: true,
      accessToken: true,
      zernioAccountId: true,
    },
  });
}

/** Upserts the Contact and moves lastInboundAt forward: this reopens the window. */
async function recordInbound(account: Account, psid: string, name: string | null, at: Date) {
  return prisma.contact.upsert({
    where: { instagramAccountId_psid: { instagramAccountId: account.id, psid } },
    create: {
      workspaceId: account.workspaceId,
      instagramAccountId: account.id,
      psid,
      name,
      lastInboundAt: at,
    },
    update: { lastInboundAt: at, ...(name ? { name } : {}) },
  });
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

async function scheduleStep(
  enrollment: { id: string },
  account: Account,
  step: StepRef,
  delayMs: number
) {
  const nextRunAt = new Date(Date.now() + delayMs);
  await prisma.flowEnrollment.update({
    where: { id: enrollment.id },
    data: { nextStepPosition: step.position, nextRunAt },
  });
  // A step can be scheduled more than once (resume after a closed window),
  // and BullMQ ignores a second add with the same id, so the id carries the
  // run time. Duplicate sends are prevented by the FlowSendLog claim.
  await getDMQueue().add(
    FLOW_STEP_JOB_NAME,
    {
      accountConnectionId: account.id,
      instagramAccountId: account.instagramId,
      enrollmentId: enrollment.id,
      stepId: step.id,
      stepPosition: step.position,
    },
    { delay: delayMs, jobId: `flow_${enrollment.id}_${step.id}_${nextRunAt.getTime()}` }
  );
}

async function enroll({
  account,
  contactId,
  flow,
  automationId,
}: {
  account: Account;
  contactId: string;
  flow: { id: string; steps: StepRef[] };
  automationId: string | null;
}): Promise<string | null> {
  const first = flow.steps[0];
  if (!first) return null;
  let enrollment: { id: string };
  try {
    enrollment = await prisma.flowEnrollment.create({
      data: {
        workspaceId: account.workspaceId,
        flowId: flow.id,
        contactId,
        automationId,
        nextStepPosition: first.position,
      },
      select: { id: true },
    });
  } catch (error) {
    // Already enrolled (a person enters a flow once).
    if (isUniqueViolation(error)) return null;
    throw error;
  }
  await scheduleStep(enrollment, account, first, Math.max(0, first.delayMinutes) * 60_000);
  return enrollment.id;
}

export interface InboundMessageInput extends AccountRef {
  psid: string;
  text: string;
  senderName?: string | null;
  at?: Date;
}

export interface InboundResult {
  enrolled: string[];
  resumed: string[];
  stopped: boolean;
}

/**
 * Runs for every inbound DM, before and independently of campaign replies.
 */
export async function handleInboundMessage(input: InboundMessageInput): Promise<InboundResult> {
  const result: InboundResult = { enrolled: [], resumed: [], stopped: false };
  const account = await findAccount(input);
  if (!account) return result;
  const now = input.at ?? new Date();
  const contact = await recordInbound(account, input.psid, input.senderName ?? null, now);

  const flows = await prisma.flow.findMany({
    where: { instagramAccountId: account.id, isActive: true },
    select: {
      id: true,
      triggerAnyMessage: true,
      triggerKeywords: true,
      wholeWordMatch: true,
      stopKeywords: true,
      resumeOnReply: true,
      steps: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, delayMinutes: true },
      },
    },
  });

  // Opt-out wins over everything else and applies to the whole Page.
  if (flows.some((flow) => matchesStopKeyword(input.text, flow.stopKeywords))) {
    await prisma.flowEnrollment.updateMany({
      where: {
        contactId: contact.id,
        status: { in: ["ACTIVE", "PAUSED_WINDOW", "PAUSED_TAKEOVER"] },
      },
      data: { status: "STOPPED_OPTOUT", endedAt: now, nextRunAt: null },
    });
    await prisma.contact.update({ where: { id: contact.id }, data: { optedOutAt: now } });
    await sendOptOutConfirmation(account, input.psid);
    result.stopped = true;
    return result;
  }
  if (contact.optedOutAt) return result;

  const existing = await prisma.flowEnrollment.findMany({
    where: { contactId: contact.id },
    select: { id: true, flowId: true, status: true, nextStepPosition: true },
  });
  const byFlow = new Map(existing.map((e) => [e.flowId, e]));

  // A reply reopens the window: paused steps go out now.
  for (const flow of flows) {
    const enrollment = byFlow.get(flow.id);
    if (!enrollment || enrollment.status !== "PAUSED_WINDOW" || !flow.resumeOnReply) continue;
    const step = flow.steps.find((s) => s.position === enrollment.nextStepPosition);
    if (!step) continue;
    await prisma.flowEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "ACTIVE" },
    });
    await scheduleStep(enrollment, account, step, 0);
    result.resumed.push(enrollment.id);
  }

  // Flows tied to a comment-to-DM campaign whose private reply this person
  // received recently, plus flows whose own trigger matches the message.
  const campaignLogs = await prisma.dmLog.findMany({
    where: {
      instagramAccountId: account.id,
      recipientId: input.psid,
      status: "SENT",
      dmSentAt: { gte: new Date(now.getTime() - CAMPAIGN_REPLY_LOOKBACK_MS) },
      automation: { isActive: true, flowId: { not: null } },
    },
    select: { automationId: true, automation: { select: { flowId: true } } },
    orderBy: { dmSentAt: "desc" },
  });
  const sourceAutomation = new Map<string, string>();
  for (const log of campaignLogs) {
    const flowId = log.automation.flowId;
    if (flowId && !sourceAutomation.has(flowId)) sourceAutomation.set(flowId, log.automationId);
  }

  for (const flow of flows) {
    if (byFlow.has(flow.id)) continue;
    const fromCampaign = sourceAutomation.get(flow.id) ?? null;
    if (!fromCampaign && !flowMatchesMessage(flow, input.text)) continue;
    const id = await enroll({ account, contactId: contact.id, flow, automationId: fromCampaign });
    if (id) result.enrolled.push(id);
  }
  return result;
}

/**
 * A tap on a comment-to-DM button counts as the person's interaction: it
 * refreshes the window and starts the campaign's flow, if it has one.
 */
export async function handleInboundPostback(
  input: AccountRef & { psid: string; automationId: string; senderName?: string | null; at?: Date }
): Promise<string | null> {
  const account = await findAccount(input);
  if (!account) return null;
  const now = input.at ?? new Date();
  const contact = await recordInbound(account, input.psid, input.senderName ?? null, now);
  if (contact.optedOutAt) return null;

  const automation = await prisma.automation.findFirst({
    where: { id: input.automationId, instagramAccountId: account.id },
    select: {
      flow: {
        select: {
          id: true,
          isActive: true,
          steps: { orderBy: { position: "asc" }, select: { id: true, position: true, delayMinutes: true } },
        },
      },
    },
  });
  const flow = automation?.flow;
  if (!flow || !flow.isActive) return null;
  return enroll({ account, contactId: contact.id, flow, automationId: input.automationId });
}

async function sendOptOutConfirmation(account: Account, psid: string) {
  if (!hasInstagramCredentials(account)) return;
  try {
    const context = await createInstagramContext(account);
    await sendDirectMessage({
      context,
      instagramAccountId: account.instagramId,
      userId: psid,
      message: OPT_OUT_CONFIRMATION,
    });
  } catch (error) {
    console.log("[Flows] Opt-out confirmation failed:", describe(error));
  }
}

// --- Step delivery -----------------------------------------------------------

type SendStatus = "CLAIMED" | "SENT" | "FAILED" | "SKIPPED_WINDOW" | "SKIPPED_TAKEOVER" | "SKIPPED_OPTOUT";

async function writeLog(
  enrollmentId: string,
  stepId: string,
  status: SendStatus,
  extra: { mid?: string | null; error?: string | null; sentAt?: Date | null } = {}
) {
  await prisma.flowSendLog.upsert({
    where: { enrollmentId_stepId: { enrollmentId, stepId } },
    create: { enrollmentId, stepId, status, ...extra },
    update: { status, ...extra },
  });
}

/**
 * The claim. Creates the step's log row as CLAIMED; if a row exists it may be
 * re-claimed only when the earlier attempt was skipped (window closed or
 * takeover) — a sent, failed or in-flight step is never sent again.
 */
async function claimStep(enrollmentId: string, stepId: string): Promise<boolean> {
  try {
    await prisma.flowSendLog.create({ data: { enrollmentId, stepId, status: "CLAIMED" } });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const reclaimed = await prisma.flowSendLog.updateMany({
      where: { enrollmentId, stepId, status: { in: ["SKIPPED_WINDOW", "SKIPPED_TAKEOVER"] } },
      data: { status: "CLAIMED", error: null },
    });
    return reclaimed.count === 1;
  }
}

async function releaseClaim(enrollmentId: string, stepId: string) {
  await prisma.flowSendLog.deleteMany({ where: { enrollmentId, stepId, status: "CLAIMED" } });
}

function describe(error: unknown) {
  if (error instanceof MetaApiError) return `${error.name} ${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : "Unknown error";
}

function isTemplateRejection(error: unknown) {
  return (
    error instanceof MetaApiError &&
    error.code === 100 &&
    /template|button/i.test(error.message) &&
    !/outside of allowed window|requested user cannot be found/i.test(error.message)
  );
}

// By subcode, not code: a Standard Access refusal ("cannot message users who
// are not admins, developers or testers") is also code 10, and pausing the
// enrollment for it would wait on a window that is in fact open.
function isWindowClosedRejection(error: unknown) {
  return isOutsideMessagingWindowError(error);
}

async function advance(
  enrollment: { id: string },
  account: Account,
  steps: StepRef[],
  current: StepRef
) {
  const next = steps.find((s) => s.position > current.position);
  if (next) {
    await scheduleStep(enrollment, account, next, Math.max(0, next.delayMinutes) * 60_000);
    return;
  }
  await prisma.flowEnrollment.update({
    where: { id: enrollment.id },
    data: { status: "COMPLETED", endedAt: new Date(), nextRunAt: null },
  });
}

async function sendStep(
  context: InstagramContext,
  account: Account,
  psid: string,
  text: string,
  buttons: { title: string; slug: string; url: string }[]
): Promise<string | undefined> {
  if (buttons.length === 0) {
    const sent = await sendDirectMessage({
      context,
      instagramAccountId: account.instagramId,
      userId: psid,
      message: text,
    });
    return sent.message_id;
  }
  const token = hashRecipientId(psid);
  const linkButtons = buttons.slice(0, 3).map((b) => ({
    title: b.title,
    url: buildTrackedUrl(b.slug, undefined, token),
  }));
  try {
    const sent = await sendDirectMessageWithLinkButton({
      context,
      instagramAccountId: account.instagramId,
      userId: psid,
      text,
      buttons: linkButtons,
    });
    return sent.message_id;
  } catch (error) {
    if (!isTemplateRejection(error)) throw error;
    // Same fallback as campaigns: the links go inline, one per line.
    const sent = await sendDirectMessage({
      context,
      instagramAccountId: account.instagramId,
      userId: psid,
      message: `${text}\n${linkButtons.map((b) => `${b.title}: ${b.url}`).join("\n")}`,
    });
    return sent.message_id;
  }
}

export async function processFlowStep(job: Job<ProcessFlowStepJob>): Promise<void> {
  const { enrollmentId, stepId } = job.data;
  const enrollment = await prisma.flowEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      contact: true,
      flow: {
        include: {
          steps: { orderBy: { position: "asc" }, include: { buttons: { orderBy: { position: "asc" } } } },
        },
      },
    },
  });
  if (!enrollment || enrollment.status !== "ACTIVE" || !enrollment.flow.isActive) return;

  const steps = enrollment.flow.steps;
  const step = steps.find((s) => s.id === stepId);
  // A stale job (step edited away, or the enrollment moved on) does nothing.
  if (!step || enrollment.nextStepPosition !== step.position) return;

  const account = await prisma.instagramAccount.findUnique({
    where: { id: enrollment.flow.instagramAccountId },
    select: {
      id: true,
      workspaceId: true,
      instagramId: true,
      provider: true,
      accessToken: true,
      zernioAccountId: true,
    },
  });
  if (!account || !hasInstagramCredentials(account)) return;

  const now = new Date();
  const contact = enrollment.contact;
  if (contact.optedOutAt) {
    await writeLog(enrollmentId, stepId, "SKIPPED_OPTOUT");
    await prisma.flowEnrollment.update({
      where: { id: enrollmentId },
      data: { status: "STOPPED_OPTOUT", endedAt: now, nextRunAt: null },
    });
    return;
  }
  if (contact.humanTakeoverUntil && contact.humanTakeoverUntil > now) {
    await writeLog(enrollmentId, stepId, "SKIPPED_TAKEOVER");
    await prisma.flowEnrollment.update({
      where: { id: enrollmentId },
      data: { status: "PAUSED_TAKEOVER", nextRunAt: null },
    });
    return;
  }
  if (!isWindowOpen(contact.lastInboundAt, now)) {
    // No Meta call: the window is closed (or about to). The person's next
    // message reopens it and, with resumeOnReply, resends this very step.
    await writeLog(enrollmentId, stepId, "SKIPPED_WINDOW");
    await prisma.flowEnrollment.update({
      where: { id: enrollmentId },
      data: { status: "PAUSED_WINDOW", nextRunAt: null },
    });
    return;
  }

  if (!(await claimStep(enrollmentId, stepId))) return;

  const rateLimit = await reserveDMSlot(account.instagramId, job.data.requeueAttempt ?? 0);
  if (!rateLimit.allowed) {
    await releaseClaim(enrollmentId, stepId);
    if (rateLimit.shouldRequeue) {
      await getDMQueue().add(
        FLOW_STEP_JOB_NAME,
        { ...job.data, requeueAttempt: (job.data.requeueAttempt ?? 0) + 1 },
        {
          delay: rateLimit.requeueDelayMs,
          jobId: `flow_${enrollmentId}_${stepId}_retry_${(job.data.requeueAttempt ?? 0) + 1}`,
        }
      );
    }
    return;
  }

  let context: InstagramContext;
  try {
    context = await createInstagramContext(account, `${job.id}:${enrollmentId}`);
  } catch (error) {
    await releaseDMSlot(account.instagramId);
    await writeLog(enrollmentId, stepId, "FAILED", { error: describe(error) });
    return;
  }

  const text = renderMessageWithoutLink({ message: step.message, commenterName: contact.name });
  try {
    const mid = await sendStep(context, account, contact.psid, text, step.buttons);
    await writeLog(enrollmentId, stepId, "SENT", { mid: mid ?? null, sentAt: new Date(), error: null });
    await advance(enrollment, account, steps, step);
  } catch (rawError) {
    const error = classifySendError(rawError);
    if (isConfirmedSendRejection(error)) await releaseDMSlot(account.instagramId);
    if (isWindowClosedRejection(error)) {
      // Meta's own clock says the window is shut: pause like a skipped step.
      await writeLog(enrollmentId, stepId, "SKIPPED_WINDOW", { error: describe(error) });
      await prisma.flowEnrollment.update({
        where: { id: enrollmentId },
        data: { status: "PAUSED_WINDOW", nextRunAt: null },
      });
      return;
    }
    // Anything else: record it and move on. The step is never retried (it may
    // have gone out), and the rest of the sequence should not be lost.
    await writeLog(enrollmentId, stepId, "FAILED", { error: describe(error) });
    await advance(enrollment, account, steps, step);
  }
}

// --- Read receipts -------------------------------------------------------------

/**
 * message_reads carries a watermark: everything sent before it was read.
 * Marks the person's SENT steps up to that time as read, for the "opened"
 * numbers.
 */
export async function markFlowReads(
  input: AccountRef & { psid: string; watermark: number }
): Promise<number> {
  const account = await findAccount(input);
  if (!account) return 0;
  const result = await prisma.flowSendLog.updateMany({
    where: {
      status: "SENT",
      readAt: null,
      sentAt: { lte: new Date(input.watermark) },
      enrollment: { contact: { instagramAccountId: account.id, psid: input.psid } },
    },
    data: { readAt: new Date() },
  });
  return result.count;
}
