import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { ConnectionError } from "@/lib/facebook/connection-error";
import { MetaApiError, PermissionError, TokenExpiredError } from "@/lib/meta/client";
import { canManageWorkspace, getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";

export { ConnectionError };

/**
 * Same shape as withZernioManagement: owner/admin only, same-origin writes,
 * and Meta errors translated into something the settings screen can show.
 */
export function withPageManagement(
  handler: (context: WorkspaceContext, request: Request) => Promise<Response>
) {
  return async (request: Request) => {
    try {
      const context = await getCurrentWorkspaceContext();
      if (!context) throw new ConnectionError("Sign in to manage your connection.", 401);
      if (!canManageWorkspace(context.role)) {
        throw new ConnectionError("Only workspace owners and admins can manage Facebook Pages.", 403);
      }
      if (request.method !== "GET") {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) {
          throw new ConnectionError("Invalid request origin.", 403);
        }
      }
      return await handler(context, request);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json(
          { success: false, error: "This Page was already connected. Refresh and try again." },
          { status: 409 }
        );
      }
      if (error instanceof ConnectionError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      if (error instanceof z.ZodError) {
        return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
      }
      if (error instanceof TokenExpiredError) {
        return NextResponse.json(
          { success: false, error: "The saved Facebook token is invalid or expired. Reconnect with Facebook." },
          { status: 502 }
        );
      }
      if (error instanceof PermissionError) {
        return NextResponse.json(
          { success: false, error: "The token is missing a permission or the Page is not available to this connection." },
          { status: 502 }
        );
      }
      if (error instanceof MetaApiError) {
        return NextResponse.json({ success: false, error: error.message }, { status: 502 });
      }
      console.error("[Facebook Pages] Unexpected error:", error);
      return NextResponse.json(
        { success: false, error: "Could not reach Meta. Please retry." },
        { status: 502 }
      );
    }
  };
}

export async function readBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new ConnectionError("Send a JSON request body.");
  }
  const input: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ConnectionError(parsed.error.issues.map((i) => i.message).join("; "));
  return parsed.data;
}
