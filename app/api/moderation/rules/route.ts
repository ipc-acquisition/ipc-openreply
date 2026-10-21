import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

const keywordList = z
  .array(z.string().trim().min(1).max(60))
  .min(1)
  .max(200)
  .transform((words) => Array.from(new Set(words)));

const createRuleSchema = z.object({
  instagramAccountId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  keywords: keywordList,
  wholeWordMatch: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

const updateRuleSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  keywords: keywordList.optional(),
  wholeWordMatch: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json(
    { success: false, error: "Only owners and admins can manage moderation rules" },
    { status: 403 }
  );
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return unauthorized();

  const instagramAccountId = request.nextUrl.searchParams.get("instagramAccountId");
  const rules = await prisma.moderationRule.findMany({
    where: {
      workspaceId,
      ...(instagramAccountId && instagramAccountId !== "all" ? { instagramAccountId } : {}),
    },
    include: {
      instagramAccount: { select: { username: true, instagramId: true } },
      _count: { select: { logs: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    { success: true, data: rules },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) return forbidden();

  const parsed = createRuleSchema.safeParse(await request.json().catch(() => null));
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
  if (!account) {
    return NextResponse.json({ success: false, error: "Page not found" }, { status: 404 });
  }

  const rule = await prisma.moderationRule.create({
    data: {
      workspaceId: context.workspaceId,
      instagramAccountId: account.id,
      name: parsed.data.name,
      keywords: parsed.data.keywords,
      wholeWordMatch: parsed.data.wholeWordMatch,
      isActive: parsed.data.isActive,
    },
  });
  return NextResponse.json({ success: true, data: rule }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) return forbidden();

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "Missing rule ID" }, { status: 400 });

  const parsed = updateRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updated = await prisma.moderationRule.updateMany({
    where: { id, workspaceId: context.workspaceId },
    data: parsed.data,
  });
  if (!updated.count) {
    return NextResponse.json({ success: false, error: "Rule not found" }, { status: 404 });
  }
  const rule = await prisma.moderationRule.findUnique({ where: { id } });
  return NextResponse.json({ success: true, data: rule });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) return forbidden();

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "Missing rule ID" }, { status: 400 });

  const deleted = await prisma.moderationRule.deleteMany({
    where: { id, workspaceId: context.workspaceId },
  });
  if (!deleted.count) {
    return NextResponse.json({ success: false, error: "Rule not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: { deleted: true } });
}
