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
  updated_at INTEGER NOT NULL,
  last_viewed_at INTEGER
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
  amount INTEGER NOT NULL,
  split_mode TEXT NOT NULL DEFAULT 'equal'
);

CREATE TABLE IF NOT EXISTS expense_participants (
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  weight REAL NOT NULL DEFAULT 1,
  share_value REAL NOT NULL DEFAULT 1,
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
    const groupColumns = databaseGlobal.chiaTienDb.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
    if (!groupColumns.some(column => column.name === "last_viewed_at")) {
      try {
        databaseGlobal.chiaTienDb.exec("ALTER TABLE groups ADD COLUMN last_viewed_at INTEGER");
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
    const participantColumns = databaseGlobal.chiaTienDb.prepare("PRAGMA table_info(expense_participants)").all() as { name: string }[];
    if (!participantColumns.some(column => column.name === "weight")) {
      try {
        databaseGlobal.chiaTienDb.exec("ALTER TABLE expense_participants ADD COLUMN weight REAL NOT NULL DEFAULT 1");
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
    const expenseColumns = databaseGlobal.chiaTienDb.prepare("PRAGMA table_info(expenses)").all() as { name: string }[];
    let addedSplitMode = false;
    if (!expenseColumns.some(column => column.name === "split_mode")) {
      try {
        databaseGlobal.chiaTienDb.exec("ALTER TABLE expenses ADD COLUMN split_mode TEXT NOT NULL DEFAULT 'equal'");
        addedSplitMode = true;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
    const updatedParticipantColumns = databaseGlobal.chiaTienDb.prepare("PRAGMA table_info(expense_participants)").all() as { name: string }[];
    let addedShareValue = false;
    if (!updatedParticipantColumns.some(column => column.name === "share_value")) {
      try {
        databaseGlobal.chiaTienDb.exec("ALTER TABLE expense_participants ADD COLUMN share_value REAL NOT NULL DEFAULT 1");
        addedShareValue = true;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
    if (addedSplitMode || addedShareValue) {
      databaseGlobal.chiaTienDb.exec(`
        UPDATE expenses SET split_mode = 'percent'
        WHERE id IN (
          SELECT expense_id FROM expense_participants
          GROUP BY expense_id HAVING MAX(weight) != MIN(weight)
        );
        UPDATE expense_participants
        SET share_value = 100.0 * weight / (
          SELECT SUM(other.weight) FROM expense_participants other
          WHERE other.expense_id = expense_participants.expense_id
        )
        WHERE expense_id IN (SELECT id FROM expenses WHERE split_mode = 'percent');
      `);
    }
  }

  return databaseGlobal.chiaTienDb;
}
