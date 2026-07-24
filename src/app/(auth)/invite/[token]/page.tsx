import { peekInvitation } from "@/lib/team-actions";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { TriangleAlert } from "lucide-react";

export const metadata = { title: "Join the workspace — Bug Tracker" };

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ name?: string; title?: string }>;
}) {
  const { token } = await params;
  const { name = "", title = "" } = await searchParams;

  const invite = await peekInvitation(token);

  if (!invite) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg p-5">
        <div className="w-full max-w-sm text-center">
          <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-danger/10 text-danger">
            <TriangleAlert size={20} />
          </span>
          <h1 className="text-[19px] font-semibold tracking-tight">This invitation isn&apos;t valid</h1>
          <p className="mt-2 text-[13px] text-muted">
            It may have expired, been revoked, or already been used. Ask an admin to send you a new link.
          </p>
          <a
            href="/login"
            className="mt-5 inline-flex h-9 items-center rounded-lg bg-surface-2 px-4 text-[13px] font-medium hover:bg-surface-3"
          >
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span
            className="grid h-11 w-11 place-items-center rounded-xl text-[18px] font-bold text-white"
            style={{ backgroundColor: invite.orgColor }}
          >
            {invite.orgName[0]}
          </span>
          <h1 className="text-[20px] font-semibold tracking-tight">Join {invite.orgName}</h1>
          <p className="text-[13px] text-muted">
            You&apos;ve been invited as <span className="font-medium text-text">{invite.role}</span>. Choose a
            password to finish setting up your account.
          </p>
        </div>
        <AcceptInviteForm
          token={token}
          email={invite.email}
          defaultName={name}
          defaultTitle={title}
        />
      </div>
    </div>
  );
}
