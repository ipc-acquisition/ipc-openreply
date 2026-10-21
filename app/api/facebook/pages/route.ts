import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getFacebookPagesState,
  removeFacebookConnection,
  saveSystemUserToken,
} from "@/lib/facebook/manage-pages";
import { readBody, withPageManagement } from "@/lib/facebook/route-handler";

const tokenBodySchema = z.object({ token: z.string().trim().min(20).max(1024) });

export const GET = withPageManagement(async ({ workspaceId }) => {
  return NextResponse.json({ success: true, data: await getFacebookPagesState(workspaceId) });
});

// The token is validated against Meta, stored encrypted and never echoed back.
export const POST = withPageManagement(async ({ workspaceId }, request) => {
  const { token } = await readBody(request, tokenBodySchema);
  const systemUser = await saveSystemUserToken(workspaceId, token);
  return NextResponse.json({ success: true, data: { systemUser } });
});

export const DELETE = withPageManagement(async ({ workspaceId }) => {
  await removeFacebookConnection(workspaceId);
  return NextResponse.json({ success: true });
});
