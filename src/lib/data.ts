import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export async function planItems(planId: string) {
  return db.select().from(schema.items).where(eq(schema.items.planId, planId)).orderBy(schema.items.createdAt);
}

export async function planSources(planId: string) {
  return db.select().from(schema.sources).where(eq(schema.sources.planId, planId)).orderBy(desc(schema.sources.createdAt));
}

export async function planClosures(planId: string) {
  return db.select().from(schema.stageClosures).where(eq(schema.stageClosures.planId, planId));
}

export type Item = typeof schema.items.$inferSelect;
export type Source = typeof schema.sources.$inferSelect;
