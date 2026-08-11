import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  collectorId: integer("collector_id").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const people = sqliteTable("people", {
  id: integer("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
}, table => [index("idx_people_group_sort").on(table.groupId, table.sortOrder)]);

export const expenses = sqliteTable("expenses", {
  id: integer("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  personId: integer("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  amount: integer("amount").notNull(),
}, table => [index("idx_expenses_group_person").on(table.groupId, table.personId)]);

export const expenseParticipants = sqliteTable("expense_participants", {
  expenseId: integer("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
  personId: integer("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
}, table => [
  primaryKey({ columns: [table.expenseId, table.personId] }),
  index("idx_expense_participants_group").on(table.groupId, table.expenseId),
]);
