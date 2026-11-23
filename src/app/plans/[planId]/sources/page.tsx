import { count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlan } from "@/lib/access";
import { planSources } from "@/lib/data";
import { addNote, deleteSource, uploadSources } from "@/app/actions";
import { NoteForm, UploadForm } from "@/components/SourceForms";
import { Submit } from "@/components/Submit";
import { fmtDate } from "@/components/ui";

const KIND: Record<string, string> = { file: "файл", url: "страница", note: "заметка" };

export default async function SourcesPage({ params }: PageProps<"/plans/[planId]/sources">) {
  const { planId } = await params;
  await requirePlan(planId);
  const sources = await planSources(planId);
  const cited = await db
    .select({ id: schema.citations.sourceId, n: count() })
    .from(schema.citations)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.citations.sourceId))
    .where(eq(schema.sources.planId, planId))
    .groupBy(schema.citations.sourceId);
  const citedN = new Map(cited.map((c) => [c.id, c.n]));
  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <h1>Источники</h1>
        <p className="prose-w mt-2">
          ИИ опирается только на эти материалы и на найденные в интернете страницы. Каждую цитату система сверяет с текстом источника; цитаты, которых в тексте нет, отбрасываются.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <UploadForm action={uploadSources.bind(null, planId)} />
        <NoteForm action={addNote.bind(null, planId)} />
      </div>
      <section className="grid gap-3">
        <h2>В плане: {sources.length}</h2>
        {sources.map((s) => (
          <div key={s.id} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                {s.kind === "file" ? (
                  <a href={`/api/plans/${planId}/sources/${s.id}`} className="link text-head">
                    {s.title}
                  </a>
                ) : s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="link text-head">
                    {s.title}
                  </a>
                ) : (
                  <span className="text-head">{s.title}</span>
                )}
                <div className="cap mt-0.5">
                  {KIND[s.kind] ?? s.kind}
                  {s.size ? ` · ${(s.size / 1024 / 1024).toFixed(1)} МБ` : ""} · {s.text.length.toLocaleString("ru-RU")} знаков · {fmtDate(s.createdAt)}
                  {citedN.get(s.id) ? ` · цитат в записях: ${citedN.get(s.id)}` : ""}
                </div>
              </div>
              <form action={deleteSource.bind(null, planId, s.id)}>
                <Submit className="cap hover:text-head" pending="…">
                  Удалить
                </Submit>
              </form>
            </div>
            {s.summary && <p className="mt-2 text-sm">{s.summary}</p>}
            {s.error && <p className="mt-2 text-sm text-red">{s.error}</p>}
          </div>
        ))}
        {sources.length === 0 && <p>Источников пока нет.</p>}
      </section>
    </div>
  );
}
