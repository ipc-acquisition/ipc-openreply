import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MetaApiError } from "@/lib/meta/client";
import { unhideComment } from "@/lib/moderation/engine";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

const bodySchema = z.object({ logId: z.string().min(1) });

/** Puts a hidden comment back on the Page (is_hidden=false). */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can unhide comments" },
      { status: 403 }
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid input" }, { status: 400 });
  }

  try {
    await unhideComment(context.workspaceId, parsed.data.logId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const status = error instanceof MetaApiError ? 502 : 400;
    const message = error instanceof Error ? error.message : "Could not unhide the comment";
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
