import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Recent moderation decisions for the workspace, newest first. */
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const instagramAccountId = request.nextUrl.searchParams.get("instagramAccountId");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 100) || 100, 500);

  const logs = await prisma.moderationLog.findMany({
    where: {
      workspaceId,
      ...(instagramAccountId && instagramAccountId !== "all" ? { instagramAccountId } : {}),
    },
    include: {
      rule: { select: { name: true } },
      instagramAccount: { select: { username: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(
    { success: true, data: logs },
    { headers: { "Cache-Control": "no-store" } }
  );
}
