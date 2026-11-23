import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "./auth";

/** Админы задаются переменной ADMIN_EMAILS (через запятую) */
export async function requireAdmin() {
  const u = await requireUser();
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!admins.includes(u.email)) notFound();
  return u;
}
