import { redirect } from "next/navigation";
import { signup } from "@/app/actions";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { currentUser } from "@/lib/auth";

export default async function SignupPage() {
  if (await currentUser()) redirect("/plans");
  return (
    <AuthShell title="Регистрация">
      <AuthForm mode="signup" action={signup} needCode={!!process.env.SIGNUP_CODE} />
    </AuthShell>
  );
}
