import Link from "next/link";
import { logout } from "@/app/actions";
import { Mark } from "./Mark";
import { Asdic } from "./ui";
import { currentUser } from "@/lib/auth";
import { wallet } from "@/lib/billing/credits";

export function TopBar({ userName, children }: { userName: string; children?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-4 border-b border-line px-4 py-3 md:px-6">
      <Link href="/plans" className="flex items-center gap-2.5 text-head">
        <Mark size={28} />
        <span className="text-[19px]">
          <Asdic />
        </span>
      </Link>
      <div className="min-w-0 flex-1">{children}</div>
      <CreditBadge />
      <span className="cap hidden sm:inline">{userName}</span>
      <form action={logout}>
        <button className="cap hover:text-head">Выйти</button>
      </form>
    </header>
  );
}

/** Остаток кредитов в шапке; ведёт на страницу тарифа */
async function CreditBadge() {
  const u = await currentUser();
  if (!u) return null;
  const w = await wallet(u.id);
  return (
    <Link href="/billing" className={`chip hover:text-head ${!w.unlimited && w.total <= 0 ? "border-red text-red" : ""}`} title="Тариф и кредиты">
      {w.unlimited ? "Админ · ∞" : `${w.tier.name} · ${Math.max(0, w.total)} кр.`}
    </Link>
  );
}
