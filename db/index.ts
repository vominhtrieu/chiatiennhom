import { resolve } from "node:path";
import Database from "better-sqlite3";

const schema = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  collector_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_participants (
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (expense_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_people_group_sort ON people(group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_expenses_group_person ON expenses(group_id, person_id);
CREATE INDEX IF NOT EXISTS idx_expense_participants_group ON expense_participants(group_id, expense_id);
`;

type DatabaseGlobal = typeof globalThis & { chiaTienDb?: Database.Database };
const databaseGlobal = globalThis as DatabaseGlobal;

export function getDb() {
  if (!databaseGlobal.chiaTienDb) {
    const databasePath = resolve(/* turbopackIgnore: true */ process.cwd(), process.env.SQLITE_DATABASE_PATH || "local.db");
    databaseGlobal.chiaTienDb = new Database(databasePath);
    databaseGlobal.chiaTienDb.exec(schema);
  }

  return databaseGlobal.chiaTienDb;
}
