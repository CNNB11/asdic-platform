import { Mark } from "./Mark";
import { Asdic } from "./ui";

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto grid min-h-screen max-w-sm content-center gap-8 px-4">
      <div className="flex items-center gap-3 text-head">
        <Mark size={40} />
        <span className="text-[27px]">
          <Asdic />
        </span>
      </div>
      <div>
        <h2>{title}</h2>
        <p className="cap mt-1">Путь из точки A в точку B. Красным отмечены решения, которые принимает только человек.</p>
      </div>
      {children}
    </main>
  );
}
