import Link from "next/link";
import type { VisualMeta } from "@/db/schema";

const KIND: Record<string, string> = { brand: "Бренд", trend: "По тренду", counter: "Контр-палитра" };

/** Палитры и шрифты бренд-борда: человек выбирает, выбор уходит в подписываемое решение уровня «Бренд» */
export function PaletteChoice({ planId, meta, taken }: { planId: string; meta: VisualMeta; taken: Set<string> }) {
  const link = (v: Record<string, string>) => `/plans/${planId}/s/brand/new?${new URLSearchParams(v)}`;
  const palettes = meta.palettes ?? [];
  const fonts = meta.fonts ?? [];
  if (!palettes.length && !fonts.length) return null;
  return (
    <div className="grid gap-3">
      {palettes.length > 0 && (
        <>
          <span className="cap">Выберите палитру: она откроется как решение «Бренд», которое вы поправите и подпишете</span>
          <div className="grid gap-3 md:grid-cols-3">
            {palettes.map((p, i) => {
              const name = `Палитра: ${p.name}`;
              const colors = p.colors.map((c) => `${c.hex} ${c.name ? `${c.name}, ` : ""}${c.role}`).join("\n");
              const href = link({
                name,
                description: `Набор «${KIND[p.kind] ?? p.kind}». ${p.why}\n\n${colors}`,
                vs_competitors: p.why,
                rationale: `Выбрана из бренд-борда: ${p.why}`,
              });
              const chosen = taken.has(name.toLowerCase());
              return (
                <div key={i} className={`card grid content-start gap-3 p-4 ${p.recommended ? "border-head/60" : ""}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-head">{p.name}</h4>
                    <span className="cap">
                      {KIND[p.kind] ?? p.kind}
                      {p.recommended ? " · рекомендуем" : ""}
                    </span>
                  </div>
                  <div className="flex h-12 overflow-hidden rounded border border-line">
                    {p.colors.map((c) => (
                      <span key={c.hex + c.role} className="flex-1" style={{ background: c.hex }} title={`${c.hex} ${c.role}`} />
                    ))}
                  </div>
                  <ul className="grid gap-0.5 text-sm">
                    {p.colors.map((c) => (
                      <li key={c.hex + c.role}>
                        <span className="font-mono">{c.hex}</span> {c.name ? `${c.name}, ` : ""}
                        <span className="cap">{c.role}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm">{p.why}</p>
                  {chosen ? (
                    <span className="chip border-head text-head">Выбрана</span>
                  ) : (
                    <Link href={href} className="btn btn-red">
                      Выбрать
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {fonts.length > 0 && (
        <div className="grid gap-2">
          <span className="cap">Шрифты борда, бесплатные, из Google Fonts</span>
          <div className="flex flex-wrap gap-3">
            {fonts.map((f) => {
              const name = `Шрифт: ${f.family}`;
              return (
                <div key={f.family + f.role} className="card grid max-w-sm gap-2 p-4">
                  <span className="text-head">
                    {f.family} <span className="cap">· {f.role}</span>
                  </span>
                  <p className="text-sm">{f.why}</p>
                  {taken.has(name.toLowerCase()) ? (
                    <span className="chip border-head text-head">Выбран</span>
                  ) : (
                    <Link
                      href={link({
                        name,
                        description: `${f.family}, ${f.role}. Бесплатный шрифт Google Fonts (лицензия OFL или Apache, коммерческое использование разрешено): https://fonts.google.com/specimen/${f.family.replace(/ /g, "+")}\n\n${f.why}`,
                        rationale: `Выбран из бренд-борда: ${f.why}`,
                      })}
                      className="btn"
                    >
                      Выбрать шрифт
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
