import { NextResponse } from "next/server";
import { z } from "zod";
import { connectFacebookPage } from "@/lib/facebook/manage-pages";
import { readBody, withPageManagement } from "@/lib/facebook/route-handler";

const bodySchema = z.object({ pageId: z.string().min(1) });

export const POST = withPageManagement(async ({ workspaceId }, request) => {
  const { pageId } = await readBody(request, bodySchema);
  const result = await connectFacebookPage(workspaceId, pageId);
  return NextResponse.json({ success: true, data: result });
});
