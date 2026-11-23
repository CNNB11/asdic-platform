import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentUser } from "./auth";

export async function planForRoute(planId: string) {
  const user = await currentUser();
  if (!user) return null;
  const [plan] = await db.select().from(schema.plans).where(and(eq(schema.plans.id, planId), eq(schema.plans.ownerId, user.id)));
  return plan ?? null;
}
