import { EMAIL_PROVIDER_ID, signIn } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";
import { DemoNotice } from "@/components/demo-notice";
import EntryShell from "@/components/entry-shell";
import { isPublicDemoHost } from "@/lib/env";

const GITHUB_URL = "https://github.com/diwenne/openreply";
const SETUP_DOCS_URL = `${GITHUB_URL}/blob/main/docs/setup.md`;

export async function generateMetadata() {
  const { t } = await getI18n();
  return {
    title: `${t("Sign in")} · IPC Reply`,
    description: t("Sign in by email to manage your Facebook Pages."),
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    checkEmail?: string;
    callbackUrl?: string;
    template?: string;
  }>;
}) {
  const { t } = await getI18n();
  if (await isPublicDemoHost()) {
    return (
      <EntryShell
        title={t("Sign-in is off on this demo")}
        description={t("This is the public demo — it doesn’t create real accounts or send DMs. To use OpenReply for real, clone it and run your own instance with your own Meta app and domain.")}
      >
        <a
          href={SETUP_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
        >
          {t("Clone it yourself")} <span aria-hidden="true">↗</span>
        </a>
      </EntryShell>
    );
  }

  const params = await searchParams;
  const checkEmail = params.checkEmail === "1";
  const selectedTemplate = getCampaignTemplate(params.template);
  const templateCallbackUrl = selectedTemplate
    ? `/campaigns/new?template=${selectedTemplate.slug}`
    : null;
  const callbackUrl = params.callbackUrl ?? templateCallbackUrl ?? "/dashboard";

  async function sendMagicLink(formData: FormData) {
    "use server";
    await signIn(EMAIL_PROVIDER_ID, {
      email: String(formData.get("email") ?? ""),
      redirectTo: callbackUrl,
    });
  }

  if (checkEmail) {
    return (
      <EntryShell
        eyebrow={t("Restricted access")}
        title={t("Check your email")}
        description={t("We sent you a secure sign-in link. Open it on this device to continue.")}
      >
        <a href="/login" className="text-sm text-accent hover:text-accent-hover">
          ← {t("Back to sign in")}
        </a>
      </EntryShell>
    );
  }

  return (
    <EntryShell
      eyebrow={t("Restricted access")}
      title={t("Sign in")}
      description={
        selectedTemplate
          ? t("Sign in to use the {name} template.", { name: selectedTemplate.title })
          : t("Sign in by email to manage your Facebook Pages.")
      }
    >
      <DemoNotice variant="panel" />

      <div className="panel rounded-xl p-6 shadow-2xl shadow-black/40">
        {selectedTemplate && (
          <div className="mb-5 rounded border border-accent/20 bg-accent/10 p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
              {t("Template selected")}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-foreground">
              {selectedTemplate.title}
            </p>
          </div>
        )}

        <form action={sendMagicLink} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="block text-sm font-medium text-foreground"
            >
              {t("Work email")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@publisherscompany.com"
              className="w-full px-3.5 py-2.5 rounded bg-background border border-border text-sm text-foreground placeholder:text-muted/70 focus:border-accent/60 focus:ring-3 focus:ring-accent/15 focus:outline-none transition-colors"
            />
          </div>

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 rounded bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
          >
            {t("Email me a magic link")}
          </button>
        </form>
      </div>
    </EntryShell>
  );
}
