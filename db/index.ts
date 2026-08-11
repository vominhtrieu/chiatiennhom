import { getDatabase } from "@netlify/database";

export function getPool() {
  return getDatabase().pool;
}
