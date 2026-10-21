import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { createFlowSchema, saveFlowSteps } from "@/lib/flows/save";
import { countUniqueClicks } from "@/lib/flows/metrics";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}

/** Flows of the workspace with headline numbers for the list screen. */
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return unauthorized();

  const instagramAccountId = request.nextUrl.searchParams.get("instagramAccountId");
  const flows = await prisma.flow.findMany({
    where: {
      workspaceId,
      ...(instagramAccountId && instagramAccountId !== "all" ? { instagramAccountId } : {}),
    },
    include: {
      instagramAccount: { select: { username: true } },
      steps: { orderBy: { position: "asc" }, select: { id: true, delayMinutes: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const flowIds = flows.map((f) => f.id);
  const stepToFlow = new Map(flows.flatMap((f) => f.steps.map((s) => [s.id, f.id] as const)));

  const [enrollmentCounts, sendCounts, readCounts, clickRows] = await Promise.all([
    prisma.flowEnrollment.groupBy({
      by: ["flowId", "status"],
      where: { flowId: { in: flowIds } },
      _count: { _all: true },
    }),
    prisma.flowSendLog.groupBy({
      by: ["stepId"],
      where: { stepId: { in: [...stepToFlow.keys()] }, status: "SENT" },
      _count: { _all: true },
    }),
    prisma.flowSendLog.groupBy({
      by: ["stepId"],
      where: { stepId: { in: [...stepToFlow.keys()] }, status: "SENT", readAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.flowClick.findMany({
      where: { button: { step: { flowId: { in: flowIds } } } },
      select: { id: true, buttonId: true, recipientHash: true, ipHash: true, button: { select: { step: { select: { flowId: true } } } } },
    }),
  ]);

  const stats = new Map(
    flowIds.map((id) => [
      id,
      { active: 0, paused: 0, completed: 0, stopped: 0, sent: 0, read: 0, clicks: 0 },
    ])
  );
  for (const row of enrollmentCounts) {
    const s = stats.get(row.flowId);
    if (!s) continue;
    const n = row._count._all;
    if (row.status === "ACTIVE") s.active += n;
    else if (row.status === "COMPLETED") s.completed += n;
    else if (row.status.startsWith("PAUSED")) s.paused += n;
    else s.stopped += n;
  }
  for (const row of sendCounts) {
    const s = stats.get(stepToFlow.get(row.stepId) ?? "");
    if (s) s.sent += row._count._all;
  }
  for (const row of readCounts) {
    const s = stats.get(stepToFlow.get(row.stepId) ?? "");
    if (s) s.read += row._count._all;
  }
  const clicksByFlow = new Map<string, typeof clickRows>();
  for (const row of clickRows) {
    const flowId = row.button.step.flowId;
    clicksByFlow.set(flowId, [...(clicksByFlow.get(flowId) ?? []), row]);
  }
  for (const [flowId, rows] of clicksByFlow) {
    const s = stats.get(flowId);
    if (s) s.clicks = countUniqueClicks(rows);
  }

  return NextResponse.json(
    {
      success: true,
      data: flows.map((flow) => {
        const s = stats.get(flow.id)!;
        return {
          id: flow.id,
          name: flow.name,
          isActive: flow.isActive,
          instagramAccountId: flow.instagramAccountId,
          instagramAccount: flow.instagramAccount,
          triggerAnyMessage: flow.triggerAnyMessage,
          triggerKeywords: flow.triggerKeywords,
          stepCount: flow.steps.length,
          createdAt: flow.createdAt,
          stats: {
            ...s,
            openRate: s.sent > 0 ? s.read / s.sent : 0,
            ctr: s.sent > 0 ? s.clicks / s.sent : 0,
          },
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Only owners and admins can create flows" }, { status: 403 });
  }

  const parsed = createFlowSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const account = await prisma.instagramAccount.findFirst({
    where: { id: parsed.data.instagramAccountId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!account) return NextResponse.json({ success: false, error: "Page not found" }, { status: 404 });

  const { steps, instagramAccountId: _ignored, ...settings } = parsed.data;
  void _ignored;
  const flow = await prisma.$transaction(async (tx) => {
    const created = await tx.flow.create({
      data: { ...settings, workspaceId: context.workspaceId, instagramAccountId: account.id },
      select: { id: true },
    });
    await saveFlowSteps(tx, created.id, steps);
    return tx.flow.findUniqueOrThrow({
      where: { id: created.id },
      include: { steps: { orderBy: { position: "asc" }, include: { buttons: { orderBy: { position: "asc" } } } } },
    });
  });

  return NextResponse.json({ success: true, data: flow }, { status: 201 });
}
