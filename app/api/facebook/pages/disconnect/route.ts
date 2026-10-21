import { NextResponse } from "next/server";
import { z } from "zod";
import { disconnectFacebookPage } from "@/lib/facebook/manage-pages";
import { readBody, withPageManagement } from "@/lib/facebook/route-handler";

const bodySchema = z.object({ accountId: z.string().min(1) });

export const POST = withPageManagement(async ({ workspaceId }, request) => {
  const { accountId } = await readBody(request, bodySchema);
  await disconnectFacebookPage(workspaceId, accountId);
  return NextResponse.json({ success: true });
});
