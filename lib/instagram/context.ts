import type { InstagramProvider } from "@/app/generated/prisma/client";
import { decryptToken } from "@/lib/meta/oauth";
import { prisma } from "@/lib/db/client";

export type InstagramContext =
  | { provider: "META"; accessToken: string }
  | {
      provider: "ZERNIO";
      apiKey: string;
      accountId: string;
      instagramId: string;
      operationId?: string;
    };

export type ProviderAccount = {
  provider: InstagramProvider;
  workspaceId: string;
  zernioAccountId: string | null;
  instagramId: string;
  accessToken: string;
};

export function hasInstagramCredentials(
  account: Pick<ProviderAccount, "provider" | "accessToken" | "zernioAccountId">
) {
  return account.provider === "ZERNIO"
    ? Boolean(account.zernioAccountId)
    : Boolean(account.accessToken);
}

export async function createInstagramContext(
  account: ProviderAccount,
  operationId?: string
): Promise<InstagramContext> {
  // Facebook Pages get their own context in a later step; until then, fail
  // loudly rather than sending Page tokens through the Instagram client.
  if (account.provider === "FACEBOOK_PAGE")
    throw new Error("Facebook Page provider is not supported yet");
  if (account.provider !== "ZERNIO")
    return { provider: "META", accessToken: decryptToken(account.accessToken) };
  if (!account.zernioAccountId)
    throw new Error("Zernio account is not connected");
  const connection = await prisma.zernioConnection.findUnique({
    where: { workspaceId: account.workspaceId },
    select: { apiKey: true },
  });
  if (!connection) throw new Error("Zernio workspace connection is missing");
  return {
    provider: "ZERNIO",
    apiKey: decryptToken(connection.apiKey),
    accountId: account.zernioAccountId,
    instagramId: account.instagramId,
    ...(operationId ? { operationId } : {}),
  };
}

export type ZernioContext = Extract<InstagramContext, { provider: "ZERNIO" }>;
