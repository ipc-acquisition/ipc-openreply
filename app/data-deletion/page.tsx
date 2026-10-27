import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Data Deletion - IPC",
  description:
    "How to stop automated messages and ask International Publishers Company to delete the data from your comments and Messenger conversations with its Facebook Pages.",
};

export default function DataDeletionPage() {
  return (
    <LegalShell
      title="Data Deletion"
      description="How to stop automated messages from our Facebook Pages and how to ask International Publishers Company (“IPC”) to delete your data."
      updatedAt="October 27, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">
          Stop Automated Messages
        </h2>
        <p className="mt-3">
          In the Messenger conversation with our Page, write “stop” (or
          “parar”, “sair”, “cancelar”). Automated messages from that Page end
          immediately and you get a short confirmation.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Delete Your Data</h2>
        <p className="mt-3">
          If you commented on or messaged one of our Facebook Pages, email{" "}
          <a
            href="mailto:privacy@publisherscompany.com"
            className="font-semibold underline"
          >
            privacy@publisherscompany.com
          </a>{" "}
          with the subject “Delete my data”, or send that request to the Page
          in Messenger. Tell us the name on your Facebook profile, the Page you
          interacted with and roughly when.
        </p>
        <p className="mt-3">
          We delete your Page-scoped ID, name, the comments and messages we
          stored, delivery logs, click records and the webhook notifications
          about you, and we confirm by reply within 30 days. Comments and
          messages that remain on Facebook itself are controlled by Meta; you
          can delete those in Facebook and Messenger.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">
          Page Administrators
        </h2>
        <p className="mt-3">
          Sign in, open Settings, and select Disconnect next to the Page. This
          removes the Page’s access token and deletes its campaigns, flows,
          contacts, delivery logs and click records. You can also remove the
          app from Facebook under Settings, Business integrations, which
          revokes its access.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Verification</h2>
        <p className="mt-3">
          We may ask a short question to confirm the request is yours before
          deleting. We keep only what the law requires us to keep.
        </p>
      </section>
    </LegalShell>
  );
}
