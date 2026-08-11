CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  collector_id BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id BIGINT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGINT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  person_id BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_participants (
  expense_id BIGINT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  person_id BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (expense_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_people_group_sort ON people(group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_expenses_group_person ON expenses(group_id, person_id);
CREATE INDEX IF NOT EXISTS idx_expense_participants_group ON expense_participants(group_id, expense_id);
