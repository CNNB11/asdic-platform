import Link from "next/link";
import { logout } from "@/app/actions";
import { Mark } from "./Mark";
import { Asdic } from "./ui";

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
      <span className="cap hidden sm:inline">{userName}</span>
      <form action={logout}>
        <button className="cap hover:text-head">Выйти</button>
      </form>
    </header>
  );
}
