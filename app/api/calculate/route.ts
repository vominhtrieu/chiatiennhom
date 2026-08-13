import { NextResponse } from "next/server";

type SplitMode = "equal" | "percent" | "amount";
type Person = { id: number; name: string; expenses: { amount: number; splitWith?: number[]; splitMode?: SplitMode; splitValues?: Record<string, number> }[] };

function sharesFor(amount: number, participantIds: number[], mode: SplitMode, values: Record<string, number> = {}) {
  if (mode === "equal") {
    const base = Math.floor(amount / participantIds.length);
    let remainder = Math.round(amount - base * participantIds.length);
    return participantIds.map(() => base + (remainder-- > 0 ? 1 : 0));
  }
  const requested = participantIds.map(id => Math.max(0, mode === "percent" ? amount * (Number(values[id]) || 0) / 100 : Number(values[id]) || 0));
  const requestedTotal = requested.reduce((sum, value) => sum + value, 0);
  return requestedTotal > 0
    ? requested.map(value => value * amount / requestedTotal)
    : participantIds.map(() => amount / participantIds.length);
}

export async function POST(request: Request) {
  const { people, collectorId } = await request.json() as { people: Person[]; collectorId: number };
  if (!Array.isArray(people) || people.length < 2) return NextResponse.json({ error: "Cần ít nhất 2 thành viên" }, { status: 400 });
  const collector = people.find(person => person.id === collectorId);
  if (!collector) return NextResponse.json({ error: "Người trung gian không hợp lệ" }, { status: 400 });

  const balances = new Map(people.map(person => [person.id, 0]));
  for (const payer of people) {
    for (const expense of payer.expenses) {
      const amount = Math.max(0, Number(expense.amount) || 0);
      const participantIds = expense.splitWith?.filter(id => balances.has(id)) ?? people.map(person => person.id);
      if (!participantIds.length) continue;
      balances.set(payer.id, (balances.get(payer.id) ?? 0) + amount);
      const shares = sharesFor(amount, participantIds, expense.splitMode ?? "equal", expense.splitValues);
      participantIds.forEach((participantId, index) => {
        balances.set(participantId, (balances.get(participantId) ?? 0) - shares[index]);
      });
    }
  }

  const transfers = people.filter(person => person.id !== collectorId).map(person => {
    const balance = balances.get(person.id) ?? 0;
    return balance < 0
      ? { from: person.name, to: collector.name, amount: Math.round(-balance) }
      : { from: collector.name, to: person.name, amount: Math.round(balance) };
  }).filter(transfer => transfer.amount > 0);
  return NextResponse.json({ transfers });
}
