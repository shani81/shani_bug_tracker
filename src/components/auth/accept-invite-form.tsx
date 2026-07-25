"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { TriangleAlert, UserPlus } from "lucide-react";
import { Button, Card, Field, Input } from "@/components/ui/primitives";
import { acceptInvitationAction, type AcceptState } from "@/lib/invite-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
      {pending ? "Creating your account…" : (<><UserPlus size={16} /> Join workspace</>)}
    </Button>
  );
}

export function AcceptInviteForm({
  token,
  email,
  defaultName,
  defaultTitle,
}: {
  token: string;
  email: string;
  defaultName: string;
  defaultTitle: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<AcceptState, FormData>(acceptInvitationAction, {});

  // The action signs the new user in on success; only then send them to the
  // app. On error we stay put so the message is visible.
  React.useEffect(() => {
    if (state.ok) {
      router.replace("/");
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <Card className="p-5">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />

        <Field label="Email">
          <Input value={email} readOnly disabled className="opacity-70" />
        </Field>
        <Field label="Your name" required>
          <Input name="name" required defaultValue={defaultName} placeholder="Alex Rivera" autoFocus />
        </Field>
        <Field label="Job title" hint="Optional">
          <Input name="title" defaultValue={defaultTitle} placeholder="Backend Engineer" />
        </Field>
        <Field label="Password" required hint="At least 8 characters">
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </Field>

        {state.error && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
          >
            <TriangleAlert size={14} /> {state.error}
          </p>
        )}

        <SubmitButton />
      </form>
    </Card>
  );
}
