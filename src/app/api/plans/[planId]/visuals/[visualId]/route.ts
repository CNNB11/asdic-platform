import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { planForRoute } from "@/lib/route-auth";
import { readStored } from "@/lib/sources";
import { VISUAL_CSP } from "@/lib/images/sanitize";

export const runtime = "nodejs";

/** Визуал концепции: как есть (SVG, HTML, картинка), скачиванием или растеризованным в PNG (?format=png) */
export async function GET(req: Request, ctx: RouteContext<"/api/plans/[planId]/visuals/[visualId]">) {
  const { planId, visualId } = await ctx.params;
  const plan = await planForRoute(planId);
  if (!plan) return new Response("Not found", { status: 404 });
  const [v] = await db.select().from(schema.visuals).where(and(eq(schema.visuals.id, visualId), eq(schema.visuals.planId, planId)));
  if (!v) return new Response("Not found", { status: 404 });
  let bytes: Buffer = await readStored(v.storageKey);
  const sp = new URL(req.url).searchParams;
  let mime = v.mime;
  let ext = v.storageKey.slice(v.storageKey.lastIndexOf("."));
  if (sp.get("format") === "png" && (mime === "image/svg+xml" || mime === "text/html")) {
    const { visualToPng } = await import("@/lib/images/png");
    bytes = await visualToPng(bytes, mime);
    mime = "image/png";
    ext = ".png";
  }
  const download = sp.has("download") || sp.get("format") === "png";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": mime === "text/html" ? "text/html; charset=utf-8" : mime,
      "content-disposition": `${download ? "attachment" : "inline"}; filename="visual-${v.id}${ext}"`,
      "x-content-type-options": "nosniff",
      // Визуалы сверстал ИИ: открываются без скриптов, шрифты только встроенные или Google Fonts
      "content-security-policy": VISUAL_CSP,
      "cache-control": "private, max-age=3600",
    },
  });
}
