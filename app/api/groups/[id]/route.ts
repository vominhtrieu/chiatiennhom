import { NextResponse } from "next/server";
import { getDb } from "@/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
type SplitMode = "equal" | "percent" | "amount";
type GroupRow = { id: string; name: string; collector_id: number; updated_at: number };
type PersonRow = { id: number; name: string; sort_order: number };
type ExpenseRow = { id: number; person_id: number; label: string; amount: number; split_mode: SplitMode };
type ParticipantRow = { expense_id: number; person_id: number; share_value: number };

function distributeValues(total: number, ids: number[], decimals = 0) {
  if (!ids.length) return {};
  const factor = 10 ** decimals;
  const totalUnits = Math.max(0, Math.round(total * factor));
  const base = Math.floor(totalUnits / ids.length);
  let remainder = totalUnits - base * ids.length;
  return Object.fromEntries(ids.map(personId => [personId, (base + (remainder-- > 0 ? 1 : 0)) / factor]));
}

function readGroup(id: string) {
  const db = getDb();
  const group = db.prepare("SELECT id, name, collector_id, updated_at FROM groups WHERE id = ?").get(id) as GroupRow | undefined;
  if (!group) return null;

  const people = db.prepare("SELECT id, name, sort_order FROM people WHERE group_id = ? ORDER BY sort_order, id").all(id) as PersonRow[];
  const expenses = db.prepare("SELECT id, person_id, label, amount, split_mode FROM expenses WHERE group_id = ? ORDER BY id").all(id) as ExpenseRow[];
  const participants = db.prepare("SELECT expense_id, person_id, share_value FROM expense_participants WHERE group_id = ? ORDER BY person_id").all(id) as ParticipantRow[];

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
          splitMode: expense.split_mode,
          splitWith: participants
            .filter((participant) => Number(participant.expense_id) === Number(expense.id))
            .map((participant) => Number(participant.person_id)),
          splitValues: Object.fromEntries(participants
            .filter((participant) => Number(participant.expense_id) === Number(expense.id))
            .map((participant) => [Number(participant.person_id), Number(participant.share_value)])),
        })),
    })),
  };
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const group = readGroup(id);
  return group
    ? NextResponse.json(group)
    : NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const now = Date.now();
  const db = getDb();

  try {
    db.exec("BEGIN IMMEDIATE");
    const group = db.prepare("SELECT collector_id FROM groups WHERE id = ?").get(id) as { collector_id: number } | undefined;
    if (!group) {
      db.exec("ROLLBACK");
      return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
    }

    const action = String(body.action ?? "");
    if (action === "renameGroup") {
      db.prepare("UPDATE groups SET name = ?, updated_at = ? WHERE id = ?").run(String(body.name ?? "").slice(0, 120), now, id);
    } else if (action === "selectCollector") {
      db.prepare("UPDATE groups SET collector_id = ?, updated_at = ? WHERE id = ?").run(Number(body.personId), now, id);
    } else if (action === "addPerson") {
      db.prepare("INSERT INTO people (id, group_id, name, sort_order) VALUES (?, ?, ?, (SELECT COUNT(*) FROM people WHERE group_id = ?))")
        .run(Number(body.personId), id, String(body.name ?? "Người mới").slice(0, 80), id);
      db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").run(now, id);
    } else if (action === "updatePerson") {
      db.prepare("UPDATE people SET name = ? WHERE id = ? AND group_id = ?").run(String(body.name ?? "").slice(0, 80), Number(body.personId), id);
      db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").run(now, id);
    } else if (action === "deletePerson") {
      const personId = Number(body.personId);
      const countRow = db.prepare("SELECT COUNT(*) AS count FROM people WHERE group_id = ?").get(id) as { count: number };
      if (Number(countRow.count) <= 2) {
        db.exec("ROLLBACK");
        return NextResponse.json({ error: "Cần ít nhất 2 thành viên" }, { status: 400 });
      }
      const replacement = db.prepare("SELECT id FROM people WHERE group_id = ? AND id != ? ORDER BY sort_order LIMIT 1").get(id, personId) as { id: number } | undefined;
      const affectedExpenses = db.prepare("SELECT expense_id FROM expense_participants WHERE group_id = ? AND person_id = ?").all(id, personId) as { expense_id: number }[];
      db.prepare("INSERT INTO expense_participants (expense_id, person_id, group_id) SELECT e.id, e.person_id, e.group_id FROM expenses e WHERE e.group_id = ? AND e.person_id != ? AND EXISTS (SELECT 1 FROM expense_participants ep WHERE ep.expense_id = e.id AND ep.person_id = ?) AND NOT EXISTS (SELECT 1 FROM expense_participants ep2 WHERE ep2.expense_id = e.id AND ep2.person_id != ?) ON CONFLICT DO NOTHING")
        .run(id, personId, personId, personId);
      db.prepare("DELETE FROM people WHERE id = ? AND group_id = ?").run(personId, id);
      const updateShare = db.prepare("UPDATE expense_participants SET share_value = ? WHERE expense_id = ? AND person_id = ?");
      for (const { expense_id: expenseId } of affectedExpenses) {
        const expense = db.prepare("SELECT amount, split_mode FROM expenses WHERE id = ? AND group_id = ?").get(expenseId, id) as { amount: number; split_mode: SplitMode } | undefined;
        const participants = db.prepare("SELECT person_id FROM expense_participants WHERE expense_id = ? ORDER BY person_id").all(expenseId) as { person_id: number }[];
        if (!expense || !participants.length) continue;
        const participantIds = participants.map(participant => Number(participant.person_id));
        const target = expense.split_mode === "percent" ? 100 : expense.split_mode === "amount" ? Number(expense.amount) : participantIds.length;
        const values = expense.split_mode === "equal"
          ? Object.fromEntries(participantIds.map(participantId => [participantId, 1]))
          : distributeValues(target, participantIds, expense.split_mode === "percent" ? 2 : 0);
        participantIds.forEach(participantId => updateShare.run(values[participantId], expenseId, participantId));
      }
      db.prepare("UPDATE groups SET collector_id = CASE WHEN collector_id = ? THEN ? ELSE collector_id END, updated_at = ? WHERE id = ?")
        .run(personId, Number(replacement?.id ?? group.collector_id), now, id);
    } else if (action === "addExpense") {
      const expenseId = Number(body.expenseId);
      const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map(Number) : [];
      db.prepare("INSERT INTO expenses (id, group_id, person_id, label, amount, split_mode) VALUES (?, ?, ?, '', 0, 'equal')").run(expenseId, id, Number(body.personId));
      const insertParticipant = db.prepare("INSERT INTO expense_participants (expense_id, person_id, group_id, weight, share_value) VALUES (?, ?, ?, 1, 1)");
      for (const participantId of participantIds) insertParticipant.run(expenseId, participantId, id);
      db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").run(now, id);
    } else if (action === "updateExpense") {
      const expenseId = Number(body.expenseId);
      if (body.field === "amount") {
        db.prepare("UPDATE expenses SET amount = ? WHERE id = ? AND group_id = ?").run(Math.max(0, Math.round(Number(body.value) || 0)), expenseId, id);
      } else {
        db.prepare("UPDATE expenses SET label = ? WHERE id = ? AND group_id = ?").run(String(body.value ?? "").slice(0, 120), expenseId, id);
      }
      db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").run(now, id);
    } else if (action === "deleteExpense") {
      db.prepare("DELETE FROM expenses WHERE id = ? AND group_id = ?").run(Number(body.expenseId), id);
      db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").run(now, id);
    } else if (action === "updateExpenseParticipants") {
      const expenseId = Number(body.expenseId);
      const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map(Number) : [];
      const mode: SplitMode = body.mode === "percent" || body.mode === "amount" ? body.mode : "equal";
      const values = body.values && typeof body.values === "object" ? body.values as Record<string, unknown> : {};
      if (!participantIds.length) {
        db.exec("ROLLBACK");
        return NextResponse.json({ error: "Khoản chi cần ít nhất một người" }, { status: 400 });
      }
      db.prepare("DELETE FROM expense_participants WHERE expense_id = ? AND group_id = ?").run(expenseId, id);
      db.prepare("UPDATE expenses SET split_mode = ? WHERE id = ? AND group_id = ?").run(mode, expenseId, id);
      const insertParticipant = db.prepare("INSERT INTO expense_participants (expense_id, person_id, group_id, weight, share_value) VALUES (?, ?, ?, 1, ?)");
      for (const participantId of participantIds) {
        const fallback = mode === "equal" ? 1 : 0;
        insertParticipant.run(expenseId, participantId, id, Math.max(0, Number(values[participantId]) || fallback));
      }
      db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").run(now, id);
    } else {
      db.exec("ROLLBACK");
      return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 });
    }

    db.exec("COMMIT");
    return NextResponse.json({ ok: true, updatedAt: now });
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* no active transaction */ }
    console.error("Unable to update group", error);
    return NextResponse.json({ error: "Không thể cập nhật nhóm" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  try {
    const result = getDb().prepare("DELETE FROM groups WHERE id = ?").run(id);
    return result.changes
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
  } catch (error) {
    console.error("Unable to delete group", error);
    return NextResponse.json({ error: "Không thể xóa nhóm" }, { status: 500 });
  }
}
