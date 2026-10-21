"use client";

import type { StaticMessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
/**
 * Status pill for DM status: a tinted chip with a dot; color carries the state.
 */

const statusConfig: Record<string, { tone: string; label: StaticMessageKey }> = {
  SENT: { tone: "bg-success/10 text-success", label: "Sent" },
  FAILED: { tone: "bg-error/10 text-error", label: "Failed" },
  PENDING: { tone: "bg-warning/10 text-warning", label: "Pending" },
  SKIPPED_DEDUP: { tone: "bg-surface-hover text-muted", label: "Dedup" },
  SKIPPED_RATE_LIMIT: { tone: "bg-warning/10 text-warning", label: "Rate limited" },
  SKIPPED_PLAN_LIMIT: { tone: "bg-warning/10 text-warning", label: "Skipped" },
  SKIPPED_NO_MATCH: { tone: "bg-surface-hover text-muted", label: "No match" },
};

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useI18n();
  const config = statusConfig[status] ?? statusConfig.PENDING;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${config.tone}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(config.label)}
    </span>
  );
}
