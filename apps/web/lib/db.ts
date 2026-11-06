import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.ts";

function createDb(url: string) {
  return drizzle(neon(url), { schema });
}

let client: ReturnType<typeof createDb> | null = null;

export function db() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = createDb(url);
  }
  return client;
}
