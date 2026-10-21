import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import EntryShell from "@/components/entry-shell";

export async function generateMetadata() {
  const { t } = await getI18n();
  return {
    title: `${t("Check your email")} · IPC Reply`,
    description: t("A sign-in link was sent to your email."),
  };
}

export default async function VerifyRequestPage() {
  const { t } = await getI18n();
  return (
    <EntryShell
      eyebrow={t("Restricted access")}
      title={t("Check your email")}
      description={t("We sent you a secure sign-in link. Open it on this device to continue.")}
    >
      <Link href="/login" className="text-sm text-accent hover:text-accent-hover">
        ← {t("Back to sign in")}
      </Link>
    </EntryShell>
  );
}
