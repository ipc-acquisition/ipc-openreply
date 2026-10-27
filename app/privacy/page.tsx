import type { Metadata } from "next";
import Link from "next/link";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy - IPC",
  description:
    "How International Publishers Company handles data from its Facebook Pages, Messenger conversations and comment moderation.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      description="International Publishers Company (“IPC”, “we”) runs this tool to answer comments and Messenger conversations on the Facebook Pages our business owns. It is not offered to other businesses."
      updatedAt="October 27, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">Who This Covers</h2>
        <p className="mt-3">
          This policy covers two groups: members of our team who sign in to the
          tool, and people who comment on our Facebook Pages, posts or ads, or
          send messages to our Pages in Messenger.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Data We Collect</h2>
        <p className="mt-3">From people who interact with our Pages:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            The Page-scoped ID that Facebook assigns to you for our Page, and
            the name Facebook shares with it.
          </li>
          <li>
            The text of comments you leave on our posts and ads, and of the
            messages you exchange with our Page in Messenger.
          </li>
          <li>
            Button taps, read receipts, delivery status and the time of each
            interaction.
          </li>
          <li>
            Clicks on links we send you. We store a one-way hash of your
            identifier and of your IP address, the browser user agent and the
            referring page, never the IP address itself.
          </li>
        </ul>
        <p className="mt-3">From our team and Page administrators:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>The email address used to sign in to the tool.</li>
          <li>
            When a Page administrator connects our Pages with Facebook Login
            for Business: their Facebook user ID and name, a user access token,
            and access tokens for the Pages they select.
          </li>
        </ul>
        <p className="mt-3">
          We also keep the webhook notifications Meta sends us about these
          events, campaign and flow settings, and operational logs.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">How We Use Data</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            To send one private reply to a comment that asks for it, and a
            public reply under that comment.
          </li>
          <li>
            To continue a Messenger conversation you start or opt into, only
            inside the 24-hour messaging window Meta allows. We do not use
            message tags and never message you outside that window.
          </li>
          <li>
            To stop all automated messages when you write “stop” (or “parar”,
            “sair”, “cancelar”).
          </li>
          <li>
            To hide comments on our own Pages that contain spam, scams or
            offensive content.
          </li>
          <li>
            To measure delivery, reads and link clicks, troubleshoot failures
            and keep the service secure.
          </li>
        </ul>
        <p className="mt-3">
          We do not sell your data, share it with advertisers, or use it to
          target ads. We do not ask for Facebook passwords, scrape Facebook or
          use browser automation. All actions go through Meta’s official APIs
          with the permissions a Page administrator granted.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Service Providers</h2>
        <p className="mt-3">
          We use Vercel (website and webhooks), Railway (message queue and
          sending), Supabase (database) and Resend (sign-in email). If we turn
          on AI-assisted moderation or replies, the text of a comment is sent
          to Anthropic to classify it or draft a reply. These providers process
          data only to run the service for us. Meta processes your comments and
          messages as the operator of Facebook and Messenger.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Security</h2>
        <p className="mt-3">
          Access tokens are encrypted at rest with AES-256-GCM and are never
          sent to the browser. Only team members on an approved email list can
          sign in.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Retention And Deletion</h2>
        <p className="mt-3">
          We keep data while the Page it belongs to is connected. Disconnecting
          a Page deletes its campaigns, flows, contacts, delivery logs and click
          records. You can ask us to delete your data at any time; see the{" "}
          <Link href="/data-deletion" className="font-semibold underline">
            Data Deletion
          </Link>{" "}
          page.
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
