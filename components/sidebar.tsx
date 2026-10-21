"use client";

/**
 * Sidebar Navigation
 *
 * Icon + label nav with a green rail on the active item, and the workspace
 * section at the bottom.
 */

import BrandLogo from "@/components/brand-logo";
import LanguageSwitcher from "@/components/language-switcher";
import {
  CampaignsIcon,
  DashboardIcon,
  DiagnosticsIcon,
  InboxIcon,
  LogsIcon,
  OverviewIcon,
  SettingsIcon,
} from "@/components/nav-icons";
import { useI18n } from "@/lib/i18n/provider";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Dashboard", href: "/dashboard", Icon: DashboardIcon },
  { label: "Overview", href: "/overview", Icon: OverviewIcon },
  { label: "Inbox", href: "/inbox", Icon: InboxIcon },
  { label: "Campaigns", href: "/campaigns", Icon: CampaignsIcon },
  { label: "DM Logs", href: "/logs", Icon: LogsIcon },
  { label: "Settings", href: "/settings", Icon: SettingsIcon },
  { label: "Diagnostics", href: "/diagnostics", Icon: DiagnosticsIcon },
] as const;

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function Sidebar({
  isOpen,
  onClose,
  workspaceName,
}: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-dvh w-64 max-w-[85vw] shrink-0 bg-surface border-r border-border flex flex-col
          transition-transform duration-300 ease-out
          lg:h-full lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Same reason as the top bar: the drawer is full height, so the
            wordmark would otherwise land under the status bar. */}
        <div
          className="flex items-center px-5 border-b border-border"
          style={{
            height: "calc(4rem + env(safe-area-inset-top))",
            paddingTop: "env(safe-area-inset-top)",
          }}
        >
          <Link href="/dashboard" aria-label="IPC Reply" className="rounded">
            <BrandLogo />
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map(({ label, href, Icon }) => {
            const isActive =
              pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={`
                  group relative flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors duration-150
                  ${
                    isActive
                      ? "bg-surface-hover text-foreground font-medium"
                      : "text-muted hover:text-foreground hover:bg-surface-hover/60"
                  }
                `}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-5 w-[3px] -translate-x-3 -translate-y-1/2 rounded-r bg-accent"
                  />
                )}
                <Icon
                  className={`h-[18px] w-[18px] shrink-0 ${
                    isActive ? "text-accent" : "text-muted group-hover:text-foreground"
                  }`}
                />
                {t(label)}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-border space-y-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded bg-accent/10 font-mono text-xs font-semibold uppercase text-accent"
            >
              {workspaceName.trim().charAt(0) || "I"}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-foreground truncate">{workspaceName}</p>
              <p className="eyebrow mt-0.5">{t("Self-hosted")}</p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
      </aside>
    </>
  );
}
