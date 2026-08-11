import { NextResponse } from "next/server";
import { getDb } from "@/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
type GroupRow = { id: string; name: string; collector_id: number; updated_at: number };
type PersonRow = { id: number; name: string; sort_order: number };
type ExpenseRow = { id: number; person_id: number; label: string; amount: number };
type ParticipantRow = { expense_id: number; person_id: number };

async function readGroup(id: string) {
  const db = await getDb();
  const groupResult = await db.execute({
    sql: "SELECT id, name, collector_id, updated_at FROM groups WHERE id = ?",
    args: [id],
  });
  const group = groupResult.rows[0] as unknown as GroupRow | undefined;
  if (!group) return null;

  const [peopleResult, expensesResult, participantsResult] = await Promise.all([
    db.execute({ sql: "SELECT id, name, sort_order FROM people WHERE group_id = ? ORDER BY sort_order, id", args: [id] }),
    db.execute({ sql: "SELECT id, person_id, label, amount FROM expenses WHERE group_id = ? ORDER BY id", args: [id] }),
    db.execute({ sql: "SELECT expense_id, person_id FROM expense_participants WHERE group_id = ? ORDER BY person_id", args: [id] }),
  ]);
  const people = peopleResult.rows as unknown as PersonRow[];
  const expenses = expensesResult.rows as unknown as ExpenseRow[];
  const participants = participantsResult.rows as unknown as ParticipantRow[];

  return {
    id: group.id,
    name: group.name,
    collectorId: Number(group.collector_id),
    updatedAt: Number(group.updated_at),
    people: people.map((person) => ({
      id: Number(person.id),
      name: person.name,
      expenses: expenses
        .filter((expense) => Number(expense.person_id) === Number(person.id))
        .map((expense) => ({
          id: Number(expense.id),
          label: expense.label,
          amount: Number(expense.amount),
          splitWith: participants
            .filter((participant) => Number(participant.expense_id) === Number(expense.id))
            .map((participant) => Number(participant.person_id)),
        })),
    })),
  };
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const group = await readGroup(id);
  return group
    ? NextResponse.json(group)
    : NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const now = Date.now();

  try {
    const db = await getDb();
    const transaction = await db.transaction("write");
    try {
      const groupResult = await transaction.execute({
        sql: "SELECT collector_id FROM groups WHERE id = ?",
        args: [id],
      });
      const group = groupResult.rows[0] as unknown as { collector_id: number } | undefined;
      if (!group) {
        await transaction.rollback();
        return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
      }

      const action = String(body.action ?? "");
      if (action === "renameGroup") {
        await transaction.execute({ sql: "UPDATE groups SET name = ?, updated_at = ? WHERE id = ?", args: [String(body.name ?? "").slice(0, 120), now, id] });
      } else if (action === "selectCollector") {
        await transaction.execute({ sql: "UPDATE groups SET collector_id = ?, updated_at = ? WHERE id = ?", args: [Number(body.personId), now, id] });
      } else if (action === "addPerson") {
        await transaction.execute({
          sql: "INSERT INTO people (id, group_id, name, sort_order) VALUES (?, ?, ?, (SELECT COUNT(*) FROM people WHERE group_id = ?))",
          args: [Number(body.personId), id, String(body.name ?? "Người mới").slice(0, 80), id],
        });
        await transaction.execute({ sql: "UPDATE groups SET updated_at = ? WHERE id = ?", args: [now, id] });
      } else if (action === "updatePerson") {
        await transaction.execute({ sql: "UPDATE people SET name = ? WHERE id = ? AND group_id = ?", args: [String(body.name ?? "").slice(0, 80), Number(body.personId), id] });
        await transaction.execute({ sql: "UPDATE groups SET updated_at = ? WHERE id = ?", args: [now, id] });
      } else if (action === "deletePerson") {
        const personId = Number(body.personId);
        const countResult = await transaction.execute({ sql: "SELECT COUNT(*) AS count FROM people WHERE group_id = ?", args: [id] });
        const count = Number((countResult.rows[0] as unknown as { count: number } | undefined)?.count ?? 0);
        if (count <= 2) {
          await transaction.rollback();
          return NextResponse.json({ error: "Cần ít nhất 2 thành viên" }, { status: 400 });
        }
        const replacementResult = await transaction.execute({ sql: "SELECT id FROM people WHERE group_id = ? AND id != ? ORDER BY sort_order LIMIT 1", args: [id, personId] });
        const replacement = replacementResult.rows[0] as unknown as { id: number } | undefined;
        await transaction.execute({
          sql: "INSERT INTO expense_participants (expense_id, person_id, group_id) SELECT e.id, e.person_id, e.group_id FROM expenses e WHERE e.group_id = ? AND e.person_id != ? AND EXISTS (SELECT 1 FROM expense_participants ep WHERE ep.expense_id = e.id AND ep.person_id = ?) AND NOT EXISTS (SELECT 1 FROM expense_participants ep2 WHERE ep2.expense_id = e.id AND ep2.person_id != ?) ON CONFLICT DO NOTHING",
          args: [id, personId, personId, personId],
        });
        await transaction.execute({ sql: "DELETE FROM people WHERE id = ? AND group_id = ?", args: [personId, id] });
        await transaction.execute({
          sql: "UPDATE groups SET collector_id = CASE WHEN collector_id = ? THEN ? ELSE collector_id END, updated_at = ? WHERE id = ?",
          args: [personId, Number(replacement?.id ?? group.collector_id), now, id],
        });
      } else if (action === "addExpense") {
        const expenseId = Number(body.expenseId);
        const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map(Number) : [];
        await transaction.execute({ sql: "INSERT INTO expenses (id, group_id, person_id, label, amount) VALUES (?, ?, ?, '', 0)", args: [expenseId, id, Number(body.personId)] });
        for (const participantId of participantIds) {
          await transaction.execute({ sql: "INSERT INTO expense_participants (expense_id, person_id, group_id) VALUES (?, ?, ?)", args: [expenseId, participantId, id] });
        }
        await transaction.execute({ sql: "UPDATE groups SET updated_at = ? WHERE id = ?", args: [now, id] });
      } else if (action === "updateExpense") {
        const expenseId = Number(body.expenseId);
        if (body.field === "amount") {
          await transaction.execute({ sql: "UPDATE expenses SET amount = ? WHERE id = ? AND group_id = ?", args: [Math.max(0, Math.round(Number(body.value) || 0)), expenseId, id] });
        } else {
          await transaction.execute({ sql: "UPDATE expenses SET label = ? WHERE id = ? AND group_id = ?", args: [String(body.value ?? "").slice(0, 120), expenseId, id] });
        }
        await transaction.execute({ sql: "UPDATE groups SET updated_at = ? WHERE id = ?", args: [now, id] });
      } else if (action === "deleteExpense") {
        await transaction.execute({ sql: "DELETE FROM expenses WHERE id = ? AND group_id = ?", args: [Number(body.expenseId), id] });
        await transaction.execute({ sql: "UPDATE groups SET updated_at = ? WHERE id = ?", args: [now, id] });
      } else if (action === "updateExpenseParticipants") {
        const expenseId = Number(body.expenseId);
        const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map(Number) : [];
        if (!participantIds.length) {
          await transaction.rollback();
          return NextResponse.json({ error: "Khoản chi cần ít nhất một người" }, { status: 400 });
        }
        await transaction.execute({ sql: "DELETE FROM expense_participants WHERE expense_id = ? AND group_id = ?", args: [expenseId, id] });
        for (const participantId of participantIds) {
          await transaction.execute({ sql: "INSERT INTO expense_participants (expense_id, person_id, group_id) VALUES (?, ?, ?)", args: [expenseId, participantId, id] });
        }
        await transaction.execute({ sql: "UPDATE groups SET updated_at = ? WHERE id = ?", args: [now, id] });
      } else {
        await transaction.rollback();
        return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 });
      }

      await transaction.commit();
      return NextResponse.json({ ok: true, updatedAt: now });
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
  } catch (error) {
    console.error("Unable to update group", error);
    return NextResponse.json({ error: "Không thể cập nhật nhóm" }, { status: 500 });
  }
}
