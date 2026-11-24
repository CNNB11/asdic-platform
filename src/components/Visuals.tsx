import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { editVisual, generateVisual, setVisualVerdict } from "@/app/actions";
import { imageProvider } from "@/lib/images/provider";
import { PendingNote, Submit } from "@/components/Submit";
import { fmtDate } from "@/components/ui";
import { PaletteChoice } from "@/components/PaletteChoice";
import { storedKeys } from "@/lib/sources";
import { Cost } from "@/components/Cost";

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
  edited,
  error,
}: {
  planId: string;
  item: typeof schema.items.$inferSelect;
  made?: string;
  failed?: string;
  edited?: boolean;
  error?: string;
}) {
  const rows = await db.select().from(schema.visuals).where(eq(schema.visuals.itemId, item.id)).orderBy(desc(schema.visuals.createdAt));
  let provider: { label: string; mock?: boolean; selfLogged?: boolean } | null = null;
  let providerError = "";
  try {
    provider = await imageProvider();
  } catch (e) {
    providerError = (e as Error).message;
  }
  const aspect = String(item.values.aspect || "1:1");
  const board = item.values.kind === "moodboard" || item.values.kind === "concept";
  const brandItems = board
    ? await db.select({ values: schema.items.values }).from(schema.items).where(and(eq(schema.items.planId, planId), eq(schema.items.sectionKey, "brand")))
    : [];
  const taken = new Set(brandItems.map((b) => String(b.values.name ?? "").trim().toLowerCase()));
  const present = await storedKeys(rows.map((r) => r.storageKey));
  const lost = rows.filter((r) => !present.has(r.storageKey)).length;
  const spent = rows.reduce((n, r) => n + Number(r.costUsd), 0);

  return (
    <section id="visuals" className="card grid gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3>{board ? "Бренд-борды" : "Макеты"}</h3>
        <span className="cap">
          {provider ? `Генерирует: ${provider.label}` : providerError}
          {spent > 0 ? ` · потрачено ≈ $${spent.toFixed(2)}` : ""}
        </span>
      </div>
      {provider?.mock && <p className="cap">Включена тестовая заглушка (IMAGE_PROVIDER=mock): картинки не настоящие.</p>}
      {provider?.selfLogged && (
        <p className="cap">
          {board
            ? "Claude верстает бренд-борд кодом: знак, его версии и размеры, палитра, шрифт, применение и принципы. Опирается на утверждённые записи плана."
            : "Claude верстает макет кодом с настоящим текстом в цветах и шрифте бренда. Опирается на утверждённые записи плана."}
        </p>
      )}
      {made && (
        <p className="text-head">
          Готово: {made}
          {failed ? `, не получилось: ${failed}` : ""}.
        </p>
      )}
      {edited && <p className="text-head">Правка готова: новая версия сверху, прежняя сохранена ниже.</p>}
      {error && <p className="text-red">{error}</p>}
      {lost > 0 && (
        <p className="card border-amber/50 px-4 py-3">
          Утеряно файлов: {lost}. Раньше визуалы хранились на диске сервера и стёрлись при его перезапуске. Нажмите «{rows.length ? "Сделать ещё" : "Сверстать"}», новый вариант сохранится в базе и больше не пропадёт. Утерянные можно отклонить, чтобы они не мешали.
        </p>
      )}

      {provider && (
        <form action={generateVisual.bind(null, planId, item.id)} className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="cap">Вариантов</span>
            <select name="count" defaultValue="1" className="field w-24">
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          {!board && (
          <label className="grid gap-1">
            <span className="cap">Формат</span>
            <select name="aspect" defaultValue={aspect} className="field w-32">
              {Object.keys(RATIO).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          )}
          <div>
            <Submit pending={board ? "Claude верстает бренд-борд…" : "Claude верстает макет…"}>{rows.length ? "Сделать ещё" : board ? "Сверстать бренд-борд" : "Сверстать макет"}</Submit>
            <PendingNote text={board ? "Бренд-борд занимает 1–3 минуты. Не закрывайте страницу." : "Макет занимает до минуты. Не закрывайте страницу."} />
          </div>
          <div className="basis-full">
            <Cost kind="image" note="Один вариант стоит" />
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="cap">Пока ничего нет. Проверьте бриф выше: его можно поправить кнопкой «Редактировать».</p>
      ) : (
        <ul className={`grid gap-6 ${board ? "" : "sm:grid-cols-2"}`}>
          {rows.map((v) => (
            <li key={v.id} className={`grid content-start gap-2 ${v.verdict === "rejected" ? "opacity-50" : ""}`}>
              {v.mime === "text/html" ? (
                <iframe
                  src={`/api/plans/${planId}/visuals/${v.id}`}
                  title={`Бренд-борд от ${fmtDate(v.createdAt)}`}
                  sandbox=""
                  loading="lazy"
                  className="h-[720px] w-full rounded border border-line bg-white"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/plans/${planId}/visuals/${v.id}`}
                  alt={`Вариант концепции от ${fmtDate(v.createdAt)}`}
                  className="w-full rounded border border-line object-cover"
                  style={{ aspectRatio: RATIO[v.aspect] ?? "1 / 1" }}
                />
              )}
              {v.notes && <p className="text-sm">{v.notes}</p>}
              {v.meta && <PaletteChoice planId={planId} meta={v.meta} taken={taken} />}
              {board && v.mime === "text/html" && !v.meta && (
                <p className="cap">Карточки выбора палитры и шрифта появляются у бордов, сверстанных после обновления. Нажмите «Сделать ещё», чтобы получить их.</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap gap-2">
                  <span className={`chip ${v.verdict === "accepted" || v.verdict === "base" ? "border-head text-head" : ""}`}>
                    {VERDICT_LABEL[v.verdict] ?? v.verdict}
                    {v.verdictBy ? ` · ${v.verdictBy}` : ""}
                  </span>
                  {v.parentId && <span className="chip">Версия после правки</span>}
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
                {(v.mime === "text/html" || v.mime === "image/svg+xml") && (
                  <a href={`/api/plans/${planId}/visuals/${v.id}?format=png`} className="btn btn-ghost">
                    PNG
                  </a>
                )}
                <a href={`/api/plans/${planId}/visuals/${v.id}?download=1`} className="btn btn-ghost">
                  {v.mime === "text/html" ? "HTML" : v.mime === "image/svg+xml" ? "SVG" : "Скачать"}
                </a>
                {v.mime === "text/html" && (
                  <a href={`/api/plans/${planId}/visuals/${v.id}`} target="_blank" rel="noopener" className="btn btn-ghost">
                    Открыть целиком
                  </a>
                )}
              </div>
              {(v.mime === "text/html" || v.mime === "image/svg+xml") && provider?.selfLogged && (
                <form action={editVisual.bind(null, planId, v.id)} className="grid gap-2">
                  <label className="grid gap-1">
                    <span className="cap">Точечная правка: Claude поменяет только это, остальное останется как есть</span>
                    <textarea
                      name="instruction"
                      rows={2}
                      maxLength={2000}
                      className="field"
                      placeholder="Например: акцент теплее; анимация вдвое медленнее; заголовок короче; знак толще в 16 px"
                    />
                  </label>
                  <div>
                    <Submit className="btn" pending="Claude правит…">
                      Поправить
                    </Submit>
                    <PendingNote text="Обычно до минуты." />
                  </div>
                </form>
              )}
              <details>
                <summary className="cap cursor-pointer">{v.parentId ? "Что просили поправить" : "Бриф, по которому сделано"}</summary>
                <p className="mt-1 text-sm">{v.prompt}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
