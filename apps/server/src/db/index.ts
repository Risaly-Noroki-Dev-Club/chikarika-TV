import postgres from "postgres";
import { env } from "../env.js";

export const sql = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = sql;
