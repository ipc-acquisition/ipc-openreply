import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { MetaApiError } from "@/lib/meta/client";
import { setPageCommentHidden } from "@/lib/meta/page-client";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { normalizeForModeration } from "./normalize";

/**
 * Word-list moderation, run at the top of processComment before any campaign.
 *
 * Claim-before-call, like every other Meta write here: the ModerationLog row
 * (unique per comment) is created first, the hide is attempted second, and
 * the outcome is written back. A retry of the same comment finds the row and
 * reuses its decision instead of calling Meta again.
 *
 * A comment that matched a rule is "blocked" whether or not the hide itself
 * succeeded — spam never gets a private reply or a public reply.
 */

export interface ModerationInput {
  accountConnectionId?: string;
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId?: string;
}

export type ModerationDecision =
  | { blocked: false }
  | { blocked: true; logId: string; matchedKeyword: string | null };

export function findMatchingRule<R extends { keywords: string[]; wholeWordMatch: boolean }>(
  commentText: string,
  rules: R[]
): { rule: R; keyword: string } | null {
  const text = normalizeForModeration(commentText);
  if (!text) return null;
  for (const rule of rules) {
    const normalized = rule.keywords.map(normalizeForModeration);
    const result = matchKeywords(text, normalized, rule.wholeWordMatch);
    if (result.matched && result.matchedKeyword !== null) {
      const index = normalized.indexOf(result.matchedKeyword);
      return { rule, keyword: rule.keywords[index] ?? result.matchedKeyword };
    }
  }
  return null;
}

function describe(error: unknown) {
  if (error instanceof MetaApiError) return `${error.name} ${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : "Unknown error";
}

export async function moderateComment(input: ModerationInput): Promise<ModerationDecision> {
  const account = await prisma.instagramAccount.findFirst({
    where: input.accountConnectionId
      ? { id: input.accountConnectionId }
      : { instagramId: input.instagramAccountId },
    select: { id: true, workspaceId: true, provider: true, accessToken: true },
  });
  if (!account) return { blocked: false };

  const rules = await prisma.moderationRule.findMany({
    where: { instagramAccountId: account.id, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, keywords: true, wholeWordMatch: true, action: true },
  });
  if (rules.length === 0) return { blocked: false };

  const existing = await prisma.moderationLog.findUnique({
    where: { commentId: input.commentId },
    select: { id: true, actionStatus: true, matchedKeyword: true },
  });
  if (existing) return decisionFor(existing);

  const match = findMatchingRule(input.commentText, rules);
  if (!match) return { blocked: false };

  // The claim. A concurrent job for the same comment loses on the unique
  // index and reads the winner's row instead.
  let log: { id: string; actionStatus: "PENDING" | "DONE" | "FAILED" | "UNDONE"; matchedKeyword: string | null };
  try {
    log = await prisma.moderationLog.create({
      data: {
        workspaceId: account.workspaceId,
        instagramAccountId: account.id,
        ruleId: match.rule.id,
        commentId: input.commentId,
        mediaId: input.mediaId ?? null,
        commenterId: input.commenterId,
        commenterName: input.commenterName ?? null,
        commentText: input.commentText,
        matchedKeyword: match.keyword,
        action: match.rule.action,
        actionStatus: "PENDING",
      },
      select: { id: true, actionStatus: true, matchedKeyword: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await prisma.moderationLog.findUnique({
        where: { commentId: input.commentId },
        select: { id: true, actionStatus: true, matchedKeyword: true },
      });
      if (winner) return decisionFor(winner);
    }
    throw error;
  }

  let actionStatus: "DONE" | "FAILED" = "DONE";
  let errorMessage: string | null = null;
  if (account.provider !== "FACEBOOK_PAGE") {
    actionStatus = "FAILED";
    errorMessage = "Hiding comments is only supported for Facebook Pages";
  } else {
    try {
      // Only HIDE is offered in the UI; DELETE stays in the enum for later.
      await setPageCommentHidden(decryptToken(account.accessToken), input.commentId, true);
    } catch (error) {
      actionStatus = "FAILED";
      errorMessage = describe(error);
      console.log("[Moderation] Hide failed:", errorMessage);
    }
  }

  await prisma.moderationLog.update({
    where: { id: log.id },
    data: { actionStatus, error: errorMessage },
  });
  return { blocked: true, logId: log.id, matchedKeyword: log.matchedKeyword };
}

/** Re-shows a hidden comment on the Page and marks the log UNDONE. */
export async function unhideComment(workspaceId: string, logId: string): Promise<void> {
  const log = await prisma.moderationLog.findFirst({
    where: { id: logId, workspaceId },
    include: { instagramAccount: { select: { provider: true, accessToken: true } } },
  });
  if (!log) throw new Error("Moderation log not found");
  if (log.instagramAccount.provider !== "FACEBOOK_PAGE") {
    throw new Error("Unhiding is only supported for Facebook Pages");
  }
  await setPageCommentHidden(decryptToken(log.instagramAccount.accessToken), log.commentId, false);
  await prisma.moderationLog.update({
    where: { id: log.id },
    data: { actionStatus: "UNDONE", error: null },
  });
}

function decisionFor(log: {
  id: string;
  actionStatus: "PENDING" | "DONE" | "FAILED" | "UNDONE";
  matchedKeyword: string | null;
}): ModerationDecision {
  // UNDONE means a person looked at it and put it back: let campaigns run.
  if (log.actionStatus === "UNDONE") return { blocked: false };
  return { blocked: true, logId: log.id, matchedKeyword: log.matchedKeyword };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
