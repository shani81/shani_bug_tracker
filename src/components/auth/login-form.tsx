"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LogIn, TriangleAlert } from "lucide-react";
import { Button, Card, Field, Input } from "@/components/ui/primitives";
import { signInAction, type SignInState } from "@/lib/auth-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : (<><LogIn size={16} /> Sign in</>)}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<SignInState, FormData>(signInAction, {});

  return (
    <Card className="p-5">
      <form action={formAction} className="flex flex-col gap-4">
        <Field label="Email" required>
          <Input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password" required>
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
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

      <div className="mt-4 rounded-lg border border-dashed border-border bg-surface-2/50 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
        <span className="font-semibold text-text">Demo workspace</span> — seeded accounts share the password{" "}
        <code className="rounded bg-surface-3 px-1 py-0.5 font-mono">demo1234</code>.
        <br />
        Owner <code className="font-mono">you@shani.dev</code> · QA <code className="font-mono">priya@acme.dev</code> ·
        Viewer-ish guest <code className="font-mono">sana@acme.dev</code>
      </div>
    </Card>
  );
}
