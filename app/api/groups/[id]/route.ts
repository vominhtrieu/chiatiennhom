import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };
type PersonRow = { id: number; name: string; sort_order: number };
type ExpenseRow = { id: number; person_id: number; label: string; amount: number };
type ParticipantRow = { expense_id: number; person_id: number };

async function readGroup(id: string) {
  const group = await env.DB.prepare("SELECT id, name, collector_id, updated_at FROM groups WHERE id = ?").bind(id).first<{ id: string; name: string; collector_id: number; updated_at: number }>();
  if (!group) return null;
  const [peopleResult, expensesResult, participantsResult] = await Promise.all([
    env.DB.prepare("SELECT id, name, sort_order FROM people WHERE group_id = ? ORDER BY sort_order, id").bind(id).all<PersonRow>(),
    env.DB.prepare("SELECT id, person_id, label, amount FROM expenses WHERE group_id = ? ORDER BY id").bind(id).all<ExpenseRow>(),
    env.DB.prepare("SELECT expense_id, person_id FROM expense_participants WHERE group_id = ? ORDER BY person_id").bind(id).all<ParticipantRow>(),
  ]);
  return {
    id: group.id,
    name: group.name,
    collectorId: group.collector_id,
    updatedAt: group.updated_at,
    people: peopleResult.results.map(person => ({ id: person.id, name: person.name, expenses: expensesResult.results.filter(expense => expense.person_id === person.id).map(expense => ({ id: expense.id, label: expense.label, amount: expense.amount, splitWith: participantsResult.results.filter(participant => participant.expense_id === expense.id).map(participant => participant.person_id) })) })),
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
  const group = await env.DB.prepare("SELECT id, collector_id FROM groups WHERE id = ?").bind(id).first<{ id: string; collector_id: number }>();
  if (!group) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });

  const action = String(body.action ?? "");
  if (action === "renameGroup") {
    await env.DB.prepare("UPDATE groups SET name = ?, updated_at = ? WHERE id = ?").bind(String(body.name ?? "").slice(0, 120), now, id).run();
  } else if (action === "selectCollector") {
    await env.DB.prepare("UPDATE groups SET collector_id = ?, updated_at = ? WHERE id = ?").bind(Number(body.personId), now, id).run();
  } else if (action === "addPerson") {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO people (id, group_id, name, sort_order) VALUES (?, ?, ?, (SELECT COUNT(*) FROM people WHERE group_id = ?))").bind(Number(body.personId), id, String(body.name ?? "Người mới").slice(0, 80), id),
      env.DB.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").bind(now, id),
    ]);
  } else if (action === "updatePerson") {
    await env.DB.batch([
      env.DB.prepare("UPDATE people SET name = ? WHERE id = ? AND group_id = ?").bind(String(body.name ?? "").slice(0, 80), Number(body.personId), id),
      env.DB.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").bind(now, id),
    ]);
  } else if (action === "deletePerson") {
    const personId = Number(body.personId);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM people WHERE group_id = ?").bind(id).first<{ count: number }>();
    if ((count?.count ?? 0) <= 2) return NextResponse.json({ error: "Cần ít nhất 2 thành viên" }, { status: 400 });
    const replacement = await env.DB.prepare("SELECT id FROM people WHERE group_id = ? AND id != ? ORDER BY sort_order LIMIT 1").bind(id, personId).first<{ id: number }>();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO expense_participants (expense_id, person_id, group_id) SELECT e.id, e.person_id, e.group_id FROM expenses e WHERE e.group_id = ? AND e.person_id != ? AND EXISTS (SELECT 1 FROM expense_participants ep WHERE ep.expense_id = e.id AND ep.person_id = ?) AND NOT EXISTS (SELECT 1 FROM expense_participants ep2 WHERE ep2.expense_id = e.id AND ep2.person_id != ?)").bind(id, personId, personId, personId),
      env.DB.prepare("DELETE FROM people WHERE id = ? AND group_id = ?").bind(personId, id),
      env.DB.prepare("UPDATE groups SET collector_id = CASE WHEN collector_id = ? THEN ? ELSE collector_id END, updated_at = ? WHERE id = ?").bind(personId, replacement?.id ?? group.collector_id, now, id),
    ]);
  } else if (action === "addExpense") {
    const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map(Number) : [];
    await env.DB.batch([
      env.DB.prepare("INSERT INTO expenses (id, group_id, person_id, label, amount) VALUES (?, ?, ?, '', 0)").bind(Number(body.expenseId), id, Number(body.personId)),
      ...participantIds.map(participantId => env.DB.prepare("INSERT INTO expense_participants (expense_id, person_id, group_id) VALUES (?, ?, ?)").bind(Number(body.expenseId), participantId, id)),
      env.DB.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").bind(now, id),
    ]);
  } else if (action === "updateExpense") {
    const field = body.field === "amount" ? "amount" : "label";
    const value = field === "amount" ? Math.max(0, Math.round(Number(body.value) || 0)) : String(body.value ?? "").slice(0, 120);
    await env.DB.batch([
      env.DB.prepare(`UPDATE expenses SET ${field} = ? WHERE id = ? AND group_id = ?`).bind(value, Number(body.expenseId), id),
      env.DB.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").bind(now, id),
    ]);
  } else if (action === "deleteExpense") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM expenses WHERE id = ? AND group_id = ?").bind(Number(body.expenseId), id),
      env.DB.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").bind(now, id),
    ]);
  } else if (action === "updateExpenseParticipants") {
    const expenseId = Number(body.expenseId);
    const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map(Number) : [];
    if (participantIds.length === 0) return NextResponse.json({ error: "Khoản chi cần ít nhất một người" }, { status: 400 });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM expense_participants WHERE expense_id = ? AND group_id = ?").bind(expenseId, id),
      ...participantIds.map(participantId => env.DB.prepare("INSERT INTO expense_participants (expense_id, person_id, group_id) VALUES (?, ?, ?)").bind(expenseId, participantId, id)),
      env.DB.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").bind(now, id),
    ]);
  } else {
    return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, updatedAt: now });
}
