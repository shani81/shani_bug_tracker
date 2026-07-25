"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { TriangleAlert, Check, KeyRound } from "lucide-react";
import { Button, Card, Field, Input } from "@/components/ui/primitives";
import { completePasswordResetAction, type ResetState } from "@/lib/reset-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
      {pending ? "Updating…" : (<><KeyRound size={16} /> Set password</>)}
    </Button>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ResetState, FormData>(completePasswordResetAction, {});

  if (state.ok) {
    return (
      <Card className="p-5 text-center">
        <p className="mb-2 flex items-center justify-center gap-2 text-[13.5px] font-medium text-success">
          <Check size={16} /> Password updated
        </p>
        <p className="mb-4 text-[12.5px] text-muted">
          Every other device has been signed out. Sign in with your new password.
        </p>
        <Link
          href="/login"
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-fg hover:opacity-90"
        >
          Go to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" required hint="At least 8 characters">
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            autoFocus
            placeholder="••••••••"
          />
        </Field>

        {state.error && (
          <p role="alert" className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
            <TriangleAlert size={14} /> {state.error}
          </p>
        )}

        <SubmitButton />
      </form>
    </Card>
  );
}
