import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/permissions";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Sign in — Bug Tracker" };

export default async function LoginPage() {
  // already signed in? go straight to the app
  const ctx = await getAuthContext();
  if (ctx) redirect("/");

  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-[20px] font-bold text-primary-fg">
            B
          </span>
          <h1 className="text-[20px] font-semibold tracking-tight">Sign in to Bug Tracker</h1>
          <p className="text-[13px] text-muted">Track bugs, ship releases, keep QA honest.</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
