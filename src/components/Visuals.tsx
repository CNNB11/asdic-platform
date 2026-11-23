import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { generateVisual, setVisualVerdict } from "@/app/actions";
import { imageProvider } from "@/lib/images/provider";
import { PendingNote, Submit } from "@/components/Submit";
import { fmtDate } from "@/components/ui";

const VERDICT_LABEL: Record<string, string> = {
  new: "Ждёт решения",
  accepted: "Принято",
  base: "Основа для дизайнера",
  rejected: "Отклонено",
};

const RATIO: Record<string, string> = { "1:1": "1 / 1", "4:5": "4 / 5", "9:16": "9 / 16", "16:9": "16 / 9" };

/** Галерея изображений концепции: генерация по промпту и решение человека по каждой картинке */
export async function Visuals({
  planId,
  item,
  made,
  failed,
  error,
}: {
  planId: string;
  item: typeof schema.items.$inferSelect;
  made?: string;
  failed?: string;
  error?: string;
}) {
  const rows = await db.select().from(schema.visuals).where(eq(schema.visuals.itemId, item.id)).orderBy(desc(schema.visuals.createdAt));
  let provider: { label: string; mock?: boolean } | null = null;
  let providerError = "";
  try {
    provider = await imageProvider();
  } catch (e) {
    providerError = (e as Error).message;
  }
  const aspect = String(item.values.aspect || "1:1");
  const spent = rows.reduce((n, r) => n + Number(r.costUsd), 0);

  return (
    <section id="visuals" className="card grid gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3>Изображения</h3>
        <span className="cap">
          {provider ? `Генерирует: ${provider.label}` : providerError}
          {spent > 0 ? ` · потрачено ≈ $${spent.toFixed(2)}` : ""}
        </span>
      </div>
      {provider?.mock && (
        <p className="cap">
          Провайдер изображений не подключён, поэтому рисуется тестовая картинка. Для России задайте YANDEX_API_KEY и YANDEX_FOLDER_ID (YandexART), для
          международного контура OPENAI_API_KEY.
        </p>
      )}
      {made && (
        <p className="text-head">
          Готово изображений: {made}
          {failed ? `, не получилось: ${failed}` : ""}.
        </p>
      )}
      {error && <p className="text-red">{error}</p>}

      {provider && (
        <form action={generateVisual.bind(null, planId, item.id)} className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="cap">Вариантов</span>
            <select name="count" defaultValue="2" className="field w-24">
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="cap">Формат</span>
            <select name="aspect" defaultValue={aspect} className="field w-32">
              {Object.keys(RATIO).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <div>
            <Submit pending="Генерирую…">{rows.length ? "Сгенерировать ещё" : "Сгенерировать по промпту"}</Submit>
            <PendingNote text="Обычно 10–40 секунд на картинку. Не закрывайте страницу." />
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="cap">Картинок пока нет. Проверьте промпт выше: его можно поправить кнопкой «Редактировать».</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map((v) => (
            <li key={v.id} className={`grid content-start gap-2 ${v.verdict === "rejected" ? "opacity-50" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/plans/${planId}/visuals/${v.id}`}
                alt={`Вариант концепции от ${fmtDate(v.createdAt)}`}
                className="w-full rounded border border-line object-cover"
                style={{ aspectRatio: RATIO[v.aspect] ?? "1 / 1" }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`chip ${v.verdict === "accepted" || v.verdict === "base" ? "border-head text-head" : ""}`}>
                  {VERDICT_LABEL[v.verdict] ?? v.verdict}
                  {v.verdictBy ? ` · ${v.verdictBy}` : ""}
                </span>
                <span className="cap">
                  {v.model} · {fmtDate(v.createdAt)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {v.verdict !== "accepted" && (
                  <form action={setVisualVerdict.bind(null, planId, v.id, "accepted")}>
                    <button className="btn">Принять</button>
                  </form>
                )}
                {v.verdict !== "base" && (
                  <form action={setVisualVerdict.bind(null, planId, v.id, "base")}>
                    <button className="btn">Взять как основу</button>
                  </form>
                )}
                {v.verdict !== "rejected" && (
                  <form action={setVisualVerdict.bind(null, planId, v.id, "rejected")}>
                    <button className="btn btn-ghost">Отклонить</button>
                  </form>
                )}
                <a href={`/api/plans/${planId}/visuals/${v.id}?download=1`} className="btn btn-ghost">
                  Скачать
                </a>
              </div>
              <details>
                <summary className="cap cursor-pointer">Промпт, который ушёл в генерацию</summary>
                <p className="mt-1 text-sm">{v.prompt}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
