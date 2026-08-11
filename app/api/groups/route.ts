import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

type Expense = { id: number; label: string; amount: number };
type Person = { id: number; name: string; expenses: Expense[] };

function makeId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

export async function POST(request: Request) {
  const { name, collectorId, people } = await request.json() as { name: string; collectorId: number; people: Person[] };
  if (!name || !Array.isArray(people) || people.length < 2) return NextResponse.json({ error: "Dữ liệu nhóm không hợp lệ" }, { status: 400 });
  const id = makeId();
  const now = Date.now();
  const statements = [
    env.DB.prepare("INSERT INTO groups (id, name, collector_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, name.slice(0, 120), collectorId, now, now),
    ...people.map((person, index) => env.DB.prepare("INSERT INTO people (id, group_id, name, sort_order) VALUES (?, ?, ?, ?)").bind(person.id, id, person.name.slice(0, 80), index)),
    ...people.flatMap(person => person.expenses.map(expense => env.DB.prepare("INSERT INTO expenses (id, group_id, person_id, label, amount) VALUES (?, ?, ?, ?, ?)").bind(expense.id, id, person.id, expense.label.slice(0, 120), Math.max(0, Math.round(expense.amount))))),
  ];
  await env.DB.batch(statements);
  return NextResponse.json({ id, updatedAt: now });
}
