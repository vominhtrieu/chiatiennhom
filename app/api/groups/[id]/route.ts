import { NextResponse } from "next/server";
import { getPool } from "@/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
type GroupRow = { id: string; name: string; collector_id: number; updated_at: number };
type PersonRow = { id: number; name: string; sort_order: number };
type ExpenseRow = { id: number; person_id: number; label: string; amount: number };
type ParticipantRow = { expense_id: number; person_id: number };

async function readGroup(id: string) {
  const pool = getPool();
  const groupResult = await pool.query<GroupRow>("SELECT id, name, collector_id, updated_at FROM groups WHERE id = $1", [id]);
  const group = groupResult.rows[0];
  if (!group) return null;
  const [peopleResult, expensesResult, participantsResult] = await Promise.all([
    pool.query<PersonRow>("SELECT id, name, sort_order FROM people WHERE group_id = $1 ORDER BY sort_order, id", [id]),
    pool.query<ExpenseRow>("SELECT id, person_id, label, amount FROM expenses WHERE group_id = $1 ORDER BY id", [id]),
    pool.query<ParticipantRow>("SELECT expense_id, person_id FROM expense_participants WHERE group_id = $1 ORDER BY person_id", [id]),
  ]);
  return {
    id: group.id,
    name: group.name,
    collectorId: Number(group.collector_id),
    updatedAt: Number(group.updated_at),
    people: (peopleResult.rows as PersonRow[]).map((person: PersonRow) => ({ id: Number(person.id), name: person.name, expenses: (expensesResult.rows as ExpenseRow[]).filter((expense: ExpenseRow) => Number(expense.person_id) === Number(person.id)).map((expense: ExpenseRow) => ({ id: Number(expense.id), label: expense.label, amount: Number(expense.amount), splitWith: (participantsResult.rows as ParticipantRow[]).filter((participant: ParticipantRow) => Number(participant.expense_id) === Number(expense.id)).map((participant: ParticipantRow) => Number(participant.person_id)) })) })),
  };
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const group = await readGroup(id);
  return group ? NextResponse.json(group) : NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const now = Date.now();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const groupResult = await client.query<{ collector_id: number }>("SELECT collector_id FROM groups WHERE id = $1 FOR UPDATE", [id]);
    const group = groupResult.rows[0];
    if (!group) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 }); }
    const action = String(body.action ?? "");

    if (action === "renameGroup") {
      await client.query("UPDATE groups SET name = $1, updated_at = $2 WHERE id = $3", [String(body.name ?? "").slice(0, 120), now, id]);
    } else if (action === "selectCollector") {
      await client.query("UPDATE groups SET collector_id = $1, updated_at = $2 WHERE id = $3", [Number(body.personId), now, id]);
    } else if (action === "addPerson") {
      await client.query("INSERT INTO people (id, group_id, name, sort_order) VALUES ($1, $2, $3, (SELECT COUNT(*) FROM people WHERE group_id = $2))", [Number(body.personId), id, String(body.name ?? "Người mới").slice(0, 80)]);
      await client.query("UPDATE groups SET updated_at = $1 WHERE id = $2", [now, id]);
    } else if (action === "updatePerson") {
      await client.query("UPDATE people SET name = $1 WHERE id = $2 AND group_id = $3", [String(body.name ?? "").slice(0, 80), Number(body.personId), id]);
      await client.query("UPDATE groups SET updated_at = $1 WHERE id = $2", [now, id]);
    } else if (action === "deletePerson") {
      const personId = Number(body.personId);
      const countResult = await client.query<{ count: string }>("SELECT COUNT(*) AS count FROM people WHERE group_id = $1", [id]);
      if (Number(countResult.rows[0]?.count ?? 0) <= 2) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Cần ít nhất 2 thành viên" }, { status: 400 }); }
      const replacementResult = await client.query<{ id: number }>("SELECT id FROM people WHERE group_id = $1 AND id != $2 ORDER BY sort_order LIMIT 1", [id, personId]);
      await client.query("INSERT INTO expense_participants (expense_id, person_id, group_id) SELECT e.id, e.person_id, e.group_id FROM expenses e WHERE e.group_id = $1 AND e.person_id != $2 AND EXISTS (SELECT 1 FROM expense_participants ep WHERE ep.expense_id = e.id AND ep.person_id = $2) AND NOT EXISTS (SELECT 1 FROM expense_participants ep2 WHERE ep2.expense_id = e.id AND ep2.person_id != $2) ON CONFLICT DO NOTHING", [id, personId]);
      await client.query("DELETE FROM people WHERE id = $1 AND group_id = $2", [personId, id]);
      await client.query("UPDATE groups SET collector_id = CASE WHEN collector_id = $1 THEN $2 ELSE collector_id END, updated_at = $3 WHERE id = $4", [personId, Number(replacementResult.rows[0]?.id ?? group.collector_id), now, id]);
    } else if (action === "addExpense") {
      const expenseId = Number(body.expenseId);
      const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map(Number) : [];
      await client.query("INSERT INTO expenses (id, group_id, person_id, label, amount) VALUES ($1, $2, $3, '', 0)", [expenseId, id, Number(body.personId)]);
      for (const participantId of participantIds) await client.query("INSERT INTO expense_participants (expense_id, person_id, group_id) VALUES ($1, $2, $3)", [expenseId, participantId, id]);
      await client.query("UPDATE groups SET updated_at = $1 WHERE id = $2", [now, id]);
    } else if (action === "updateExpense") {
      const expenseId = Number(body.expenseId);
      if (body.field === "amount") await client.query("UPDATE expenses SET amount = $1 WHERE id = $2 AND group_id = $3", [Math.max(0, Math.round(Number(body.value) || 0)), expenseId, id]);
      else await client.query("UPDATE expenses SET label = $1 WHERE id = $2 AND group_id = $3", [String(body.value ?? "").slice(0, 120), expenseId, id]);
      await client.query("UPDATE groups SET updated_at = $1 WHERE id = $2", [now, id]);
    } else if (action === "deleteExpense") {
      await client.query("DELETE FROM expenses WHERE id = $1 AND group_id = $2", [Number(body.expenseId), id]);
      await client.query("UPDATE groups SET updated_at = $1 WHERE id = $2", [now, id]);
    } else if (action === "updateExpenseParticipants") {
      const expenseId = Number(body.expenseId);
      const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map(Number) : [];
      if (!participantIds.length) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Khoản chi cần ít nhất một người" }, { status: 400 }); }
      await client.query("DELETE FROM expense_participants WHERE expense_id = $1 AND group_id = $2", [expenseId, id]);
      for (const participantId of participantIds) await client.query("INSERT INTO expense_participants (expense_id, person_id, group_id) VALUES ($1, $2, $3)", [expenseId, participantId, id]);
      await client.query("UPDATE groups SET updated_at = $1 WHERE id = $2", [now, id]);
    } else {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 });
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, updatedAt: now });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Unable to update group", error);
    return NextResponse.json({ error: "Không thể cập nhật nhóm" }, { status: 500 });
  } finally {
    client.release();
  }
}
