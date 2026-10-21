import type { InstagramProvider } from "@/app/generated/prisma/client";

/**
 * What each provider can do beyond comment → DM. The single place the worker,
 * the crons and the UI consult before offering or running a feature, so that
 * "not supported" is an explicit decision rather than a scattered check.
 */
export interface ProviderCapabilities {
  /** Can verify whether a person follows the account (follow-gated reveals). */
  followGate: boolean;
  /** Per-post insight metrics (views, reach, saves...). */
  mediaInsights: boolean;
  /** Daily follower history snapshots. */
  followerHistory: boolean;
  /** "Attach next reel" automation (Instagram-only concept). */
  nextReel: boolean;
  /** Access tokens expire and must be refreshed by the cron. */
  tokenRefresh: boolean;
}

const CAPABILITIES: Record<InstagramProvider, ProviderCapabilities> = {
  META: {
    followGate: true,
    mediaInsights: true,
    followerHistory: true,
    nextReel: true,
    tokenRefresh: true,
  },
  ZERNIO: {
    followGate: true,
    mediaInsights: true,
    followerHistory: true,
    nextReel: true,
    tokenRefresh: false,
  },
  // Facebook Pages under Standard Access: no follow status, no post insights,
  // no reels. Page tokens from a system user do not expire.
  FACEBOOK_PAGE: {
    followGate: false,
    mediaInsights: false,
    followerHistory: false,
    nextReel: false,
    tokenRefresh: false,
  },
};

export function providerCapabilities(provider: InstagramProvider): ProviderCapabilities {
  return CAPABILITIES[provider];
}
