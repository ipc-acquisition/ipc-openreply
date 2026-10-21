"use client";

import { useI18n } from "@/lib/i18n/provider";


export interface AccountOption {
  id: string;
  username: string;
  instagramId: string;
  name?: string | null;
}

interface AccountSelectProps {
  accounts: AccountOption[];
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
  label?: string;
}

export default function AccountSelect({
  accounts,
  value,
  onChange,
  includeAll = true,
  label,
}: AccountSelectProps) {
  const { t } = useI18n();
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
        {label ?? t("Instagram account")}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-52 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/60 focus:ring-3 focus:ring-accent/15"
      >
        {includeAll && <option value="all">{t("All accounts")}</option>}
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            @{account.username}
          </option>
        ))}
      </select>
    </label>
  );
}

