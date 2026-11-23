"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { FormState } from "@/app/actions";
import { ErrorNote } from "./ui";
import { Submit } from "./Submit";

export function AuthForm({ mode, action, needCode }: { mode: "login" | "signup"; action: (s: FormState, fd: FormData) => Promise<FormState>; needCode?: boolean }) {
  const [state, act] = useActionState(action, undefined);
  return (
    <form action={act} className="grid gap-4">
      {mode === "signup" && (
        <label className="grid gap-1.5">
          <span className="cap">Имя</span>
          <input name="name" className="field" required autoComplete="name" />
        </label>
      )}
      <label className="grid gap-1.5">
        <span className="cap">Почта</span>
        <input name="email" type="email" className="field" required autoComplete="email" />
      </label>
      <label className="grid gap-1.5">
        <span className="cap">Пароль</span>
        <input name="password" type="password" className="field" required minLength={mode === "signup" ? 8 : undefined} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
      </label>
      {mode === "signup" && needCode && (
        <label className="grid gap-1.5">
          <span className="cap">Код приглашения</span>
          <input name="code" className="field" required />
        </label>
      )}
      <ErrorNote text={state?.error} />
      <Submit pending="Подождите…">{mode === "login" ? "Войти" : "Создать аккаунт"}</Submit>
      <p className="cap">
        {mode === "login" ? (
          <>
            Нет аккаунта? <Link className="link" href="/signup">Зарегистрироваться</Link>
          </>
        ) : (
          <>
            Уже есть аккаунт? <Link className="link" href="/login">Войти</Link>
          </>
        )}
      </p>
    </form>
  );
}
