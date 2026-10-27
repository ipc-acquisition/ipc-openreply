import type { Metadata } from "next";
import Link from "next/link";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service - IPC",
  description:
    "Terms for the tool International Publishers Company uses to answer comments and Messenger conversations on its Facebook Pages.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      description="These terms cover the internal tool International Publishers Company (“IPC”) uses to answer comments and Messenger conversations on the Facebook Pages it owns."
      updatedAt="October 27, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">Authorized Use</h2>
        <p className="mt-3">
          The tool is used only by IPC team members on an approved email list,
          and only with Facebook Pages owned by IPC. It is not offered to other
          businesses. Each team member is responsible for the campaigns,
          keywords, links and messages they configure.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Platform Compliance</h2>
        <p className="mt-3">
          We follow the Meta Platform Terms, the Messenger Platform policies and
          applicable privacy and anti-spam laws. In practice:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>One private reply per comment, sent within 7 days of it.</li>
          <li>
            Further messages only after the person replies or taps a button,
            and only inside the 24-hour messaging window. No message tags.
          </li>
          <li>
            Anyone can stop automated messages at any time by writing “stop”
            (or “parar”, “sair”, “cancelar”).
          </li>
          <li>We never moderate or reply to our own Pages’ comments.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">
          If You Message Our Pages
        </h2>
        <p className="mt-3">
          Some replies you receive from our Pages are automated. A person from
          our team may also answer you directly. How we handle your data is
          described in the{" "}
          <Link href="/privacy" className="font-semibold underline">
            Privacy Policy
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Availability</h2>
        <p className="mt-3">
          The tool depends on Meta and on hosting, database, queue and email
          providers. We work to keep it running, but uninterrupted availability
          is not guaranteed.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Open-Source Core</h2>
        <p className="mt-3">
          The tool is built on OpenReply, which is MIT licensed. Its public
          source code does not include our data or access tokens.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Contact</h2>
        <p className="mt-3">
          International Publishers Company,{" "}
          <a
            href="mailto:privacy@publisherscompany.com"
            className="font-semibold underline"
          >
            privacy@publisherscompany.com
          </a>
          .
        </p>
      </section>
    </LegalShell>
  );
}
