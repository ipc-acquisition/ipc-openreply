"use client";

/**
 * Top Bar
 *
 * Page title, mobile hamburger, and connection status.
 */

import type { StaticMessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { usePathname } from "next/navigation";

const pageTitles: Record<string, StaticMessageKey> = {
  "/dashboard": "Dashboard",
  "/overview": "Overview",
  "/inbox": "Inbox",
  "/campaigns/import": "Import campaigns",
  "/campaigns": "Comment-to-DM",
  "/campaigns/new": "New comment-to-DM",
  "/automations": "Campaigns",
  "/automations/new": "New Campaign",
  "/logs": "DM Logs",
  "/settings": "Settings",
  "/diagnostics": "Diagnostics",
  "/moderation": "Moderation",
  "/flows": "Flows",
  "/flows/new": "New flow",
};

interface TopBarProps {
  onMenuClick: () => void;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function TopBar({
  onMenuClick,
  instagramUsername,
  instagramAccountCount,
}: TopBarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const title: StaticMessageKey = pageTitles[pathname] ?? (
    pathname.startsWith("/flows/")
      ? pathname.endsWith("/edit") ? "Edit flow" : "Flow details"
      : pathname.endsWith("/edit") ? "Edit comment-to-DM"
        : pathname.startsWith("/campaigns/") ? "Comment-to-DM details" : "Dashboard"
  );

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 lg:px-8 border-b border-border bg-background/80 backdrop-blur-md"
      // Installed to the home screen the app starts at the very top of the
      // display, so without this the title sits under the clock and battery.
      // The inset is 0 in a browser tab and on desktop.
      style={{
        height: "calc(4rem + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden shrink-0 grid h-9 w-9 place-items-center rounded border border-border text-muted hover:text-foreground hover:border-border-hover"
          aria-label={t("Toggle sidebar")}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true" className="h-[18px] w-[18px]">
            <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
          </svg>
        </button>
        <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{t(title)}</h1>
      </div>

      {instagramAccountCount > 0 ? (
        <p className="inline-flex min-w-0 shrink items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-sm text-muted">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_rgb(31_186_86/0.18)]" />
          <span className="truncate">
          {instagramAccountCount > 1
            ? t("{count} accounts", { count: instagramAccountCount })
            // Facebook Pages have a name, not a handle.
            : instagramUsername}
          </span>
        </p>
      ) : (
        <a
          href="/settings"
          className="shrink-0 whitespace-nowrap text-sm font-medium px-3 py-1.5 rounded bg-accent text-accent-foreground hover:bg-accent-hover"
        >
          {/* Full label needs more room than a 360px header has to spare. */}
          <span className="sm:hidden">{t("Connect")}</span>
          <span className="hidden sm:inline">{t("Connect Instagram")}</span>
        </a>
      )}
    </header>
  );
}
