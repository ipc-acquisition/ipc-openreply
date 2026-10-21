import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";

/**
 * Validation and persistence of a flow's step list. Steps and buttons keep
 * their ids across saves when the editor sends them back, so send logs,
 * reads and clicks stay attached; a button keeps its slug, so links already
 * delivered keep working and keep counting.
 */

export const flowButtonSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(20),
  url: z.string().url().max(2048),
});

export const flowStepSchema = z.object({
  id: z.string().min(1).optional(),
  // Up to 7 days; anything past ~24h only goes out if the person writes again.
  delayMinutes: z.number().int().min(0).max(7 * 24 * 60),
  message: z.string().trim().min(1).max(1000),
  buttons: z.array(flowButtonSchema).max(3).default([]),
});

const keywordList = z.array(z.string().trim().min(1).max(60)).max(200);

export const flowSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean().default(true),
  triggerAnyMessage: z.boolean().default(true),
  triggerKeywords: keywordList.default([]),
  wholeWordMatch: z.boolean().default(false),
  stopKeywords: z
    .array(z.string().trim().min(1).max(30))
    .max(50)
    .default(["parar", "sair", "stop", "cancelar"]),
  resumeOnReply: z.boolean().default(true),
});

export const createFlowSchema = flowSettingsSchema
  .extend({
    instagramAccountId: z.string().min(1),
    steps: z.array(flowStepSchema).min(1).max(30),
  })
  .refine((f) => f.triggerAnyMessage || f.triggerKeywords.length > 0, {
    message: "Add trigger keywords or trigger on any message",
    path: ["triggerKeywords"],
  });

export const updateFlowSchema = flowSettingsSchema
  .partial()
  .extend({ steps: z.array(flowStepSchema).min(1).max(30).optional() });

export type FlowStepInput = z.infer<typeof flowStepSchema>;

/**
 * Replace a flow's steps with `steps`, in order. Positions are unique per
 * flow, so kept rows are parked at negative positions first and renumbered
 * after deletes, which keeps any reorder from colliding mid-way.
 */
export async function saveFlowSteps(
  tx: Prisma.TransactionClient,
  flowId: string,
  steps: FlowStepInput[]
) {
  const existing = await tx.flowStep.findMany({
    where: { flowId },
    select: { id: true, buttons: { select: { id: true } } },
  });
  const existingIds = new Set(existing.map((s) => s.id));
  const keptIds = new Set(steps.map((s) => s.id).filter((id): id is string => Boolean(id) && existingIds.has(id!)));

  const removed = existing.filter((s) => !keptIds.has(s.id)).map((s) => s.id);
  if (removed.length) await tx.flowStep.deleteMany({ where: { id: { in: removed } } });

  // Park kept steps out of the way of the final numbering.
  let park = -1;
  for (const id of keptIds) {
    await tx.flowStep.update({ where: { id }, data: { position: park-- } });
  }

  for (const [position, step] of steps.entries()) {
    const keep = step.id && keptIds.has(step.id) ? step.id : null;
    const stepId = keep
      ? (
          await tx.flowStep.update({
            where: { id: keep },
            data: { position, delayMinutes: step.delayMinutes, message: step.message },
            select: { id: true },
          })
        ).id
      : (
          await tx.flowStep.create({
            data: { flowId, position, delayMinutes: step.delayMinutes, message: step.message },
            select: { id: true },
          })
        ).id;
    await saveStepButtons(tx, stepId, step.buttons, existing.find((s) => s.id === stepId)?.buttons ?? []);
  }
}

async function saveStepButtons(
  tx: Prisma.TransactionClient,
  stepId: string,
  buttons: FlowStepInput["buttons"],
  existing: { id: string }[]
) {
  const existingIds = new Set(existing.map((b) => b.id));
  const keptIds = new Set(buttons.map((b) => b.id).filter((id): id is string => Boolean(id) && existingIds.has(id!)));
  const removed = existing.filter((b) => !keptIds.has(b.id)).map((b) => b.id);
  if (removed.length) await tx.flowButton.deleteMany({ where: { id: { in: removed } } });

  let park = -1;
  for (const id of keptIds) {
    await tx.flowButton.update({ where: { id }, data: { position: park-- } });
  }
  for (const [position, button] of buttons.entries()) {
    if (button.id && keptIds.has(button.id)) {
      await tx.flowButton.update({
        where: { id: button.id },
        data: { position, title: button.title, url: button.url },
      });
    } else {
      await tx.flowButton.create({
        data: { stepId, position, title: button.title, url: button.url, slug: generateTrackedLinkSlug() },
      });
    }
  }
}
