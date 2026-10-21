import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { summarizeSteps, totalsOf } from "@/lib/flows/metrics";
import { saveFlowSteps, updateFlowSchema } from "@/lib/flows/save";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ success: false, error: "Flow not found" }, { status: 404 });
}

/** One flow with its steps, buttons and per-step numbers. */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return unauthorized();
  const { id } = await params;

  const flow = await prisma.flow.findFirst({
    where: { id, workspaceId },
    include: {
      instagramAccount: { select: { username: true } },
      steps: { orderBy: { position: "asc" }, include: { buttons: { orderBy: { position: "asc" } } } },
    },
  });
  if (!flow) return notFound();

  const stepIds = flow.steps.map((s) => s.id);
  const buttonIds = flow.steps.flatMap((s) => s.buttons.map((b) => b.id));
  const [sends, clicks, enrollmentCounts] = await Promise.all([
    prisma.flowSendLog.findMany({
      where: { stepId: { in: stepIds } },
      select: { stepId: true, status: true, readAt: true },
    }),
    prisma.flowClick.findMany({
      where: { buttonId: { in: buttonIds } },
      select: { id: true, buttonId: true, recipientHash: true, ipHash: true },
    }),
    prisma.flowEnrollment.groupBy({
      by: ["status"],
      where: { flowId: flow.id },
      _count: { _all: true },
    }),
  ]);

  const stepMetrics = summarizeSteps(flow.steps, sends, clicks);
  const enrollments = Object.fromEntries(enrollmentCounts.map((r) => [r.status, r._count._all]));

  return NextResponse.json(
    {
      success: true,
      data: { ...flow, metrics: { steps: stepMetrics, totals: totalsOf(stepMetrics), enrollments } },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Only owners and admins can update flows" }, { status: 403 });
  }
  const { id } = await params;

  const parsed = updateFlowSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.flow.findFirst({ where: { id, workspaceId: context.workspaceId }, select: { id: true } });
  if (!existing) return notFound();

  const { steps, ...settings } = parsed.data;
  const flow = await prisma.$transaction(async (tx) => {
    // Updating the flow row first locks it, so two saves run one after the
    // other and cannot interleave their step rewrites.
    await tx.flow.update({ where: { id }, data: settings });
    if (steps) await saveFlowSteps(tx, id, steps);
    return tx.flow.findUniqueOrThrow({
      where: { id },
      include: { steps: { orderBy: { position: "asc" }, include: { buttons: { orderBy: { position: "asc" } } } } },
    });
  });

  return NextResponse.json({ success: true, data: flow });
}

export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Only owners and admins can delete flows" }, { status: 403 });
  }
  const { id } = await params;
  const deleted = await prisma.flow.deleteMany({ where: { id, workspaceId: context.workspaceId } });
  if (!deleted.count) return notFound();
  return NextResponse.json({ success: true, data: { deleted: true } });
}
