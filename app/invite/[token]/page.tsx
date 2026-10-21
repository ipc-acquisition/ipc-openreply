import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import EntryShell from "@/components/entry-shell";
import InvitationAcceptCard from "@/components/invitation-accept-card";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: `${t("Workspace invitation")} · IPC Reply`,
    robots: { index: false, follow: false },
  };
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { t, label } = await getI18n();
  const { token } = await params;
  const [session, invitation] = await Promise.all([
    auth(),
    prisma.workspaceInvitation.findUnique({
      where: { token },
      include: {
        workspace: { select: { name: true } },
      },
    }),
  ]);

  if (!invitation || invitation.status !== "PENDING") {
    notFound();
  }

  const expired = invitation.expiresAt <= new Date();

  return (
    <EntryShell
      eyebrow={t("Workspace invitation")}
      title={t("Join {workspace}", { workspace: invitation.workspace.name })}
      description={t("You were invited as {role} for {email}.", { role: label(invitation.role), email: invitation.email })}
    >
      <div className="panel rounded-xl p-6 shadow-2xl shadow-black/40">
        {expired ? (
          <p className="text-sm text-error">
            {t("This invitation has expired. Ask the workspace owner to resend it.")}
          </p>
        ) : (
          <InvitationAcceptCard
            token={token}
            isSignedIn={Boolean(session?.user?.id)}
            invitedEmail={invitation.email}
          />
        )}
      </div>
    </EntryShell>
  );
}

