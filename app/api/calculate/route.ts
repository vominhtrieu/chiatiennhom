import { NextResponse } from "next/server";

type Person = { id: number; name: string; expenses: { amount: number; splitWith?: number[] }[] };

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
      const share = amount / participantIds.length;
      for (const participantId of participantIds) balances.set(participantId, (balances.get(participantId) ?? 0) - share);
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
