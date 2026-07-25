import { peekPasswordReset } from "@/lib/reset-queries";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { TriangleAlert } from "lucide-react";

export const metadata = { title: "Set a new password — Bug Tracker" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reset = await peekPasswordReset(token);

  if (!reset) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg p-5">
        <div className="w-full max-w-sm text-center">
          <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-danger/10 text-danger">
            <TriangleAlert size={20} />
          </span>
          <h1 className="text-[19px] font-semibold tracking-tight">This reset link isn&apos;t valid</h1>
          <p className="mt-2 text-[13px] text-muted">
            It may have expired, already been used, or been replaced by a newer one. Ask an admin to issue
            another.
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
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-[20px] font-bold text-primary-fg">
            B
          </span>
          <h1 className="text-[20px] font-semibold tracking-tight">Set a new password</h1>
          <p className="text-[13px] text-muted">
            for <span className="font-medium text-text">{reset.email}</span>
          </p>
        </div>
        <ResetPasswordForm token={token} />
      </div>
    </div>
  );
}
