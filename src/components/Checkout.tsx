"use client";
import { useEffect, useState } from "react";

type PaddleJs = {
  Environment: { set: (env: string) => void };
  Initialize: (o: { token: string }) => void;
  Checkout: { open: (o: unknown) => void };
};
declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

let loading: Promise<PaddleJs> | null = null;
function loadPaddle(token: string, env: string) {
  loading ??= new Promise<PaddleJs>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    s.async = true;
    s.onload = () => {
      const P = window.Paddle!;
      if (env === "sandbox") P.Environment.set("sandbox");
      P.Initialize({ token });
      resolve(P);
    };
    s.onerror = () => {
      loading = null;
      reject(new Error("Не удалось загрузить окно оплаты"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Кнопка оплаты: открывает окно Paddle поверх страницы */
export function CheckoutButton(p: { priceId: string; token: string; env: string; email: string; userId: string; children: React.ReactNode; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    loadPaddle(p.token, p.env).catch(() => {});
  }, [p.token, p.env]);
  return (
    <span className="grid gap-1">
      <button
        type="button"
        className={p.className ?? "btn btn-primary"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            const P = await loadPaddle(p.token, p.env);
            P.Checkout.open({
              items: [{ priceId: p.priceId, quantity: 1 }],
              customer: { email: p.email },
              customData: { userId: p.userId },
              settings: { displayMode: "overlay", locale: "ru", successUrl: `${location.origin}/billing?paid=1` },
            });
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Открываю…" : p.children}
      </button>
      {err && <span className="cap text-red">{err}</span>}
    </span>
  );
}
