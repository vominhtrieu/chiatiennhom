"use client";

import { useMemo, useState } from "react";

type Expense = { id: number; label: string; amount: number };
type Person = { id: number; name: string; expenses: Expense[] };
type Transfer = { from: string; to: string; amount: number };

const initialPeople: Person[] = [
  { id: 1, name: "Triều", expenses: [{ id: 11, label: "Sở thú", amount: 180000 }, { id: 12, label: "Ăn chay", amount: 320000 }] },
  { id: 2, name: "Hiền", expenses: [{ id: 21, label: "Gà nướng", amount: 199000 }, { id: 22, label: "Gỏi", amount: 92000 }, { id: 23, label: "Cá viên chiên", amount: 90000 }] },
  { id: 3, name: "Thủy", expenses: [{ id: 31, label: "Ăn vặt", amount: 30000 }] },
  { id: 4, name: "Trinh", expenses: [] },
  { id: 5, name: "Phương", expenses: [] },
];

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });

export default function Home() {
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [collectorId, setCollectorId] = useState(1);
  const [tripName, setTripName] = useState("Ăn chơi cuối tuần");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverTransfers, setServerTransfers] = useState<Transfer[] | null>(null);

  const totals = useMemo(() => people.map(p => ({ ...p, total: p.expenses.reduce((s, e) => s + Number(e.amount || 0), 0) })), [people]);
  const grandTotal = totals.reduce((s, p) => s + p.total, 0);
  const perPerson = people.length ? grandTotal / people.length : 0;
  const collector = people.find(p => p.id === collectorId) ?? people[0];

  const localTransfers = useMemo<Transfer[]>(() => {
    if (!collector) return [];
    return totals
      .filter(p => p.id !== collector.id)
      .map(p => {
        const balance = p.total - perPerson;
        return balance < 0
          ? { from: p.name, to: collector.name, amount: -balance }
          : { from: collector.name, to: p.name, amount: balance };
      })
      .filter(t => t.amount > 0.5);
  }, [collector, perPerson, totals]);

  const transfers = serverTransfers ?? localTransfers;

  function updatePerson(id: number, patch: Partial<Person>) {
    setPeople(list => list.map(p => p.id === id ? { ...p, ...patch } : p));
    setServerTransfers(null);
  }

  function updateExpense(personId: number, expenseId: number, patch: Partial<Expense>) {
    setPeople(list => list.map(p => p.id === personId ? { ...p, expenses: p.expenses.map(e => e.id === expenseId ? { ...e, ...patch } : e) } : p));
    setServerTransfers(null);
  }

  function addExpense(personId: number) {
    const id = Date.now();
    setPeople(list => list.map(p => p.id === personId ? { ...p, expenses: [...p.expenses, { id, label: "", amount: 0 }] } : p));
    setServerTransfers(null);
  }

  function removeExpense(personId: number, expenseId: number) {
    setPeople(list => list.map(p => p.id === personId ? { ...p, expenses: p.expenses.filter(e => e.id !== expenseId) } : p));
    setServerTransfers(null);
  }

  function addPerson() {
    const id = Date.now();
    setPeople(list => [...list, { id, name: `Người ${list.length + 1}`, expenses: [] }]);
  }

  function removePerson(id: number) {
    if (people.length <= 2) return;
    const next = people.filter(p => p.id !== id);
    setPeople(next);
    if (collectorId === id) setCollectorId(next[0].id);
    setServerTransfers(null);
  }

  async function calculate() {
    setLoading(true);
    try {
      const response = await fetch("/api/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ people, collectorId }) });
      const data = await response.json();
      setServerTransfers(data.transfers);
    } finally {
      setLoading(false);
    }
  }

  async function copySummary() {
    const lines = [`${tripName} — ${money.format(grandTotal)}`, ...transfers.map(t => `${t.from} → ${t.to}: ${money.format(t.amount)}`)];
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark">c</span><span>chia<span>nhanh</span></span></a>
        <div className="header-actions"><button className="icon-button" aria-label="Đổi giao diện">☼</button><button className="avatar" aria-label="Tài khoản">TV</button></div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span></span> Chia tiền nhóm, không chia tình bạn</div>
        <input className="trip-title" value={tripName} onChange={e => setTripName(e.target.value)} aria-label="Tên chuyến đi" />
        <p>Thêm chi tiêu, chọn người trung gian, và để chúng mình tính phần còn lại.</p>
        <div className="stats">
          <div><span>Tổng chi</span><strong>{money.format(grandTotal)}</strong></div>
          <i></i><div><span>Mỗi người</span><strong>{money.format(perPerson)}</strong></div>
          <i></i><div><span>Thành viên</span><strong>{people.length} người</strong></div>
        </div>
      </section>

      <div className="workspace">
        <section className="people-panel">
          <div className="section-heading"><div><span className="step">01</span><h2>Ai đã chi gì?</h2></div><p>Nhập các khoản đã thanh toán của từng người.</p></div>
          <div className="people-list">
            {totals.map(person => (
              <article className={`person-card ${person.id === collectorId ? "is-collector" : ""}`} key={person.id}>
                <div className="person-head">
                  <div className="person-name-wrap"><span className="mini-avatar">{person.name.slice(0, 1).toUpperCase()}</span><input value={person.name} onChange={e => updatePerson(person.id, { name: e.target.value })} aria-label={`Tên thành viên ${person.id}`} /></div>
                  <div className="person-total"><span>Đã chi</span><strong>{money.format(person.total)}</strong></div>
                </div>
                <div className="expense-list">
                  {person.expenses.length === 0 && <div className="empty-expense">Chưa có khoản chi nào</div>}
                  {person.expenses.map(expense => (
                    <div className="expense-row" key={expense.id}>
                      <input placeholder="Tên khoản chi" value={expense.label} onChange={e => updateExpense(person.id, expense.id, { label: e.target.value })} aria-label="Tên khoản chi" />
                      <div className="amount-field"><input inputMode="numeric" value={expense.amount || ""} placeholder="0" onChange={e => updateExpense(person.id, expense.id, { amount: Number(e.target.value.replace(/\D/g, "")) })} aria-label="Số tiền" /><span>₫</span></div>
                      <button className="remove" onClick={() => removeExpense(person.id, expense.id)} aria-label="Xóa khoản chi">×</button>
                    </div>
                  ))}
                </div>
                <div className="card-footer"><button className="add-expense" onClick={() => addExpense(person.id)}>＋ Thêm khoản chi</button><button className="delete-person" onClick={() => removePerson(person.id)} disabled={people.length <= 2}>Xóa người</button></div>
              </article>
            ))}
          </div>
          <button className="add-person" onClick={addPerson}><span>＋</span><b>Thêm thành viên</b><small>Càng đông càng vui</small></button>
        </section>

        <aside>
          <section className="collector-card">
            <div className="section-heading compact"><div><span className="step">02</span><h2>Người trung gian</h2></div><p>Người này sẽ nhận và chuyển tiền cho cả nhóm.</p></div>
            <div className="collector-options">
              {people.map(person => (
                <label className={person.id === collectorId ? "selected" : ""} key={person.id}>
                  <input type="radio" name="collector" checked={person.id === collectorId} onChange={() => { setCollectorId(person.id); setServerTransfers(null); }} />
                  <span className="radio-dot"></span><span className="mini-avatar">{person.name.slice(0, 1).toUpperCase()}</span><b>{person.name}</b>
                  {person.id === collectorId && <em>Trung gian</em>}
                </label>
              ))}
            </div>
          </section>

          <section className="result-card">
            <div className="result-head"><div><span className="step light">03</span><h2>Chuyển tiền thế nào?</h2></div><span className="done-badge">Sẵn sàng</span></div>
            <p>Mọi giao dịch đều đi qua <b>{collector?.name}</b> để dễ đối soát.</p>
            <div className="transfer-list">
              {transfers.map((transfer, index) => (
                <div className="transfer" key={`${transfer.from}-${transfer.to}-${index}`}>
                  <div className="transfer-person"><span className="mini-avatar pale">{transfer.from.slice(0,1)}</span><span>{transfer.from}</span></div>
                  <div className="arrow"><strong>{money.format(Math.round(transfer.amount))}</strong><span>→</span></div>
                  <div className="transfer-person right"><span>{transfer.to}</span><span className="mini-avatar dark">{transfer.to.slice(0,1)}</span></div>
                </div>
              ))}
              {transfers.length === 0 && <div className="all-set">✓ Cả nhóm đã cân bằng!</div>}
            </div>
            <button className="calculate" onClick={calculate} disabled={loading}>{loading ? "Đang tính…" : "Tính lại trên máy chủ"} <span>→</span></button>
            <button className="copy" onClick={copySummary}>{copied ? "✓ Đã sao chép" : "▣ Sao chép kết quả"}</button>
          </section>
          <div className="tip"><span>✦</span><p><b>Mẹo nhỏ</b>Chọn người có số dư lớn nhất làm trung gian để giảm số lần chuyển.</p></div>
        </aside>
      </div>
      <footer><span><b>c</b> chia<span>nhanh</span></span><p>Tính minh bạch. Chuyển nhẹ nhàng.</p></footer>
    </main>
  );
}
