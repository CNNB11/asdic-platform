import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { wallet } from "@/lib/billing/credits";
import { estimate, fmtCredits } from "@/lib/billing/tiers";

/** Цена ИИ-операции перед запуском и остаток кредитов */
export async function Cost({ kind, times = 1, note }: { kind: string; times?: number; note?: string }) {
  const user = await requireUser();
  const w = await wallet(user.id);
  const need = estimate(kind) * times;
  if (w.unlimited) return <p className="cap">Стоимость {fmtCredits(need)}. Для админа бесплатно.</p>;
  const short = w.total < need;
  return (
    <p className={`cap ${short ? "text-red" : ""}`}>
      {note ?? "Стоимость"} {fmtCredits(need)} · у вас {fmtCredits(Math.max(0, w.total))}.{" "}
      {short ? (
        <Link href="/billing" className="link">
          Пополнить
        </Link>
      ) : (
        "Спишется только при успехе."
      )}
    </p>
  );
}
