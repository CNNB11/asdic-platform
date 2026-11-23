import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://asdic:asdic@localhost:5432/asdic";

const g = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
const sql = g.__sql ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") g.__sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
