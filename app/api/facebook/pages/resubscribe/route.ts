import { NextResponse } from "next/server";
import { z } from "zod";
import { resubscribeFacebookPage } from "@/lib/facebook/manage-pages";
import { readBody, withPageManagement } from "@/lib/facebook/route-handler";

const bodySchema = z.object({ accountId: z.string().min(1) });

export const POST = withPageManagement(async ({ workspaceId }, request) => {
  const { accountId } = await readBody(request, bodySchema);
  const result = await resubscribeFacebookPage(workspaceId, accountId);
  return NextResponse.json({ success: true, data: result });
});
