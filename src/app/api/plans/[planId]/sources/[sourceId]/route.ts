import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { planForRoute } from "@/lib/route-auth";
import { StoredFileMissing, readStored } from "@/lib/sources";

export const runtime = "nodejs";

export async function GET(_: Request, ctx: RouteContext<"/api/plans/[planId]/sources/[sourceId]">) {
  const { planId, sourceId } = await ctx.params;
  const plan = await planForRoute(planId);
  if (!plan) return new Response("Not found", { status: 404 });
  const [s] = await db.select().from(schema.sources).where(and(eq(schema.sources.id, sourceId), eq(schema.sources.planId, planId)));
  if (!s?.storageKey) return new Response("Not found", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readStored(s.storageKey);
  } catch (e) {
    if (e instanceof StoredFileMissing) return new Response("Файл загружен до переноса хранения в базу и стёрся при перезапуске сервера. Текст источника сохранён в плане; файл можно загрузить снова.", { status: 410, headers: { "content-type": "text/plain; charset=utf-8" } });
    throw e;
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": s.mime ?? "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(s.title)}`,
      "x-content-type-options": "nosniff",
    },
  });
}
