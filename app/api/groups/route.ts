import { NextResponse } from "next/server";
import { getPool } from "@/db";

export const runtime = "nodejs";

type Expense = { id: number; label: string; amount: number; splitWith?: number[] };
type Person = { id: number; name: string; expenses: Expense[] };

function makeId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

function makeNumericId() {
  return Number.parseInt(crypto.randomUUID().replaceAll("-", "").slice(0, 13), 16);
}

export async function POST(request: Request) {
  const { name, collectorId, people } = await request.json() as { name: string; collectorId: number; people: Person[] };
  if (!name || !Array.isArray(people) || people.length < 2) return NextResponse.json({ error: "Dữ liệu nhóm không hợp lệ" }, { status: 400 });

  const id = makeId();
  const now = Date.now();
  const personIdMap = new Map(people.map(person => [person.id, makeNumericId()]));
  const expenseIdMap = new Map<number, number>();
  people.forEach(person => person.expenses.forEach(expense => expenseIdMap.set(expense.id, makeNumericId())));
  const remappedPeople = people.map(person => ({
    ...person,
    id: personIdMap.get(person.id)!,
    expenses: person.expenses.map(expense => ({
      ...expense,
      id: expenseIdMap.get(expense.id)!,
      splitWith: (expense.splitWith?.length ? expense.splitWith : people.map(member => member.id)).map(personId => personIdMap.get(personId)).filter((personId): personId is number => personId !== undefined),
    })),
  }));
  const remappedCollectorId = personIdMap.get(collectorId) ?? remappedPeople[0].id;
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO groups (id, name, collector_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)", [id, name.slice(0, 120), remappedCollectorId, now, now]);
    for (const [index, person] of remappedPeople.entries()) {
      await client.query("INSERT INTO people (id, group_id, name, sort_order) VALUES ($1, $2, $3, $4)", [person.id, id, person.name.slice(0, 80), index]);
      for (const expense of person.expenses) {
        await client.query("INSERT INTO expenses (id, group_id, person_id, label, amount) VALUES ($1, $2, $3, $4, $5)", [expense.id, id, person.id, expense.label.slice(0, 120), Math.max(0, Math.round(expense.amount))]);
        for (const participantId of expense.splitWith) await client.query("INSERT INTO expense_participants (expense_id, person_id, group_id) VALUES ($1, $2, $3)", [expense.id, participantId, id]);
      }
    }
    await client.query("COMMIT");
    return NextResponse.json({ id, updatedAt: now });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Unable to create group", error);
    return NextResponse.json({ error: "Không thể tạo nhóm" }, { status: 500 });
  } finally {
    client.release();
  }
}
