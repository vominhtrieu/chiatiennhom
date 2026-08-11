import { NextResponse } from "next/server";

type Person = { id: number; name: string; expenses: { amount: number }[] };

export async function POST(request: Request) {
  const { people, collectorId } = await request.json() as { people: Person[]; collectorId: number };
  if (!Array.isArray(people) || people.length < 2) return NextResponse.json({ error: "Cần ít nhất 2 thành viên" }, { status: 400 });
  const collector = people.find(person => person.id === collectorId);
  if (!collector) return NextResponse.json({ error: "Người trung gian không hợp lệ" }, { status: 400 });
  const totals = people.map(person => ({ ...person, total: person.expenses.reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0) }));
  const share = totals.reduce((sum, person) => sum + person.total, 0) / people.length;
  const transfers = totals.filter(person => person.id !== collectorId).map(person => {
    const balance = person.total - share;
    return balance < 0 ? { from: person.name, to: collector.name, amount: Math.round(-balance) } : { from: collector.name, to: person.name, amount: Math.round(balance) };
  }).filter(transfer => transfer.amount > 0);
  return NextResponse.json({ transfers, share: Math.round(share) });
}
