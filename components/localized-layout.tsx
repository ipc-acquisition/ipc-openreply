import { I18nProvider } from "@/lib/i18n/provider";
import { getI18n } from "@/lib/i18n/server";
import LanguageSwitcher from "@/components/language-switcher";

// Keep request cookies below the root layout so marketing pages stay static.
export default async function LocalizedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale } = await getI18n();
  return (
    <I18nProvider locale={locale}>
      <div className="absolute right-4 top-3 z-10 sm:right-8">
        <LanguageSwitcher />
      </div>
      {children}
    </I18nProvider>
  );
}
