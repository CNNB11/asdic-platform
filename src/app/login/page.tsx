import { redirect } from "next/navigation";
import { login } from "@/app/actions";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { currentUser } from "@/lib/auth";

export default async function LoginPage() {
  if (await currentUser()) redirect("/plans");
  return (
    <AuthShell title="Вход">
      <AuthForm mode="login" action={login} />
    </AuthShell>
  );
}
