import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { planForRoute } from "@/lib/route-auth";
import type { DocModel } from "@/lib/export/model";
import { renderDocx } from "@/lib/export/docx";
import { pageChrome, renderHtml } from "@/lib/export/html";
import { htmlToPdf } from "@/lib/export/pdf";

export const runtime = "nodejs";

export async function GET(_: Request, ctx: RouteContext<"/api/plans/[planId]/documents/[docId]/[format]">) {
  const { planId, docId, format } = await ctx.params;
  const plan = await planForRoute(planId);
  if (!plan) return new Response("Not found", { status: 404 });
  const [doc] = await db.select().from(schema.documents).where(and(eq(schema.documents.id, docId), eq(schema.documents.planId, planId)));
  if (!doc) return new Response("Not found", { status: 404 });
  const model = doc.model as DocModel;
  const full = model.kind === "full";
  const base = (full ? `strategy-v${doc.version}` : `${model.stageNum}-${model.stageTitle}-v${doc.version}`).toLowerCase();
  const name = (ext: string) => `attachment; filename="${base}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${plan.title} · ${full ? "Стратегия" : model.stageTitle} v${doc.version}.${ext}`)}`;
  if (format === "md") return new Response(doc.markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": name("md") } });
  if (format === "docx") {
    const buf = await renderDocx(model);
    return new Response(new Uint8Array(buf), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": name("docx") } });
  }
  if (format === "pdf") {
    const buf = await htmlToPdf(await renderHtml(model), pageChrome(model));
    return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf", "content-disposition": name("pdf") } });
  }
  if (format === "web") return new Response(await renderHtml(model), { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": name("html") } });
  if (format === "html") return new Response(await renderHtml(model), { headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response("Unknown format", { status: 400 });
}
