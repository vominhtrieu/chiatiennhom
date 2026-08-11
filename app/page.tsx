"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Expense = { id: number; label: string; amount: number; splitWith: number[] };
type Person = { id: number; name: string; expenses: Expense[] };
type Transfer = { from: string; to: string; amount: number };

const initialPeople: Person[] = [
  { id: 1, name: "Triều", expenses: [{ id: 11, label: "Sở thú", amount: 180000, splitWith: [1,2,3,4,5] }, { id: 12, label: "Ăn chay", amount: 320000, splitWith: [1,2,3,4,5] }] },
  { id: 2, name: "Hiền", expenses: [{ id: 21, label: "Gà nướng", amount: 199000, splitWith: [1,2,3,4,5] }, { id: 22, label: "Gỏi", amount: 92000, splitWith: [1,2,3,4,5] }, { id: 23, label: "Cá viên chiên", amount: 90000, splitWith: [1,2,3,4,5] }] },
  { id: 3, name: "Thủy", expenses: [{ id: 31, label: "Ăn vặt", amount: 30000, splitWith: [1,2,3,4,5] }] },
  { id: 4, name: "Trinh", expenses: [] },
  { id: 5, name: "Phương", expenses: [] },
];

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const newNumericId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

export default function Home({ groupRoute = false }: { groupRoute?: boolean }) {
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [collectorId, setCollectorId] = useState(1);
  const [tripName, setTripName] = useState("Ăn chơi cuối tuần");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverTransfers, setServerTransfers] = useState<Transfer[] | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [syncState, setSyncState] = useState<"local" | "loading" | "saving" | "synced" | "error">("local");
  const [toast, setToast] = useState("");
  const [openSplitId, setOpenSplitId] = useState<number | null>(null);
  const lastLocalChange = useRef(0);
  const lastServerUpdate = useRef(0);

  useEffect(() => {
    if (!groupRoute) return;
    const match = window.location.pathname.match(/^\/g\/([a-z0-9]+)$/);
    if (!match) return;
    const id = match[1];
    setGroupId(id);
    setSyncState("loading");
    fetch(`/api/groups/${id}`).then(async response => {
      if (!response.ok) throw new Error("not-found");
      const data = await response.json();
      setTripName(data.name); setPeople(data.people); setCollectorId(data.collectorId);
      lastServerUpdate.current = data.updatedAt; setSyncState("synced");
    }).catch(() => { setSyncState("error"); setToast("Không tìm thấy nhóm chia tiền này"); });
  }, [groupRoute]);

  useEffect(() => {
    if (!groupId) return;
    const timer = window.setInterval(async () => {
      if (Date.now() - lastLocalChange.current < 1800) return;
      try {
        const response = await fetch(`/api/groups/${groupId}`);
        if (!response.ok) return;
        const data = await response.json();
        if (data.updatedAt > lastServerUpdate.current) {
          setTripName(data.name); setPeople(data.people); setCollectorId(data.collectorId);
          lastServerUpdate.current = data.updatedAt; setServerTransfers(null);
          setToast("Đã nhận cập nhật mới từ nhóm");
          window.setTimeout(() => setToast(""), 1600);
        }
        setSyncState("synced");
      } catch { setSyncState("error"); }
    }, 3500);
    return () => window.clearInterval(timer);
  }, [groupId]);

  async function mutate(payload: Record<string, unknown>) {
    if (!groupId) return;
    lastLocalChange.current = Date.now(); setSyncState("saving");
    try {
      const response = await fetch(`/api/groups/${groupId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      lastServerUpdate.current = data.updatedAt; setSyncState("synced");
    } catch { setSyncState("error"); }
  }

  const totals = useMemo(() => people.map(p => ({ ...p, total: p.expenses.reduce((s, e) => s + Number(e.amount || 0), 0) })), [people]);
  const grandTotal = totals.reduce((s, p) => s + p.total, 0);
  const perPerson = people.length ? grandTotal / people.length : 0;
  const collector = people.find(p => p.id === collectorId) ?? people[0];

  const localTransfers = useMemo<Transfer[]>(() => {
    if (!collector) return [];
    const balances = new Map(people.map(person => [person.id, 0]));
    for (const payer of people) {
      for (const expense of payer.expenses) {
        const participantIds = expense.splitWith?.filter(id => balances.has(id)) ?? people.map(person => person.id);
        if (!participantIds.length) continue;
        balances.set(payer.id, (balances.get(payer.id) ?? 0) + expense.amount);
        const share = expense.amount / participantIds.length;
        participantIds.forEach(id => balances.set(id, (balances.get(id) ?? 0) - share));
      }
    }
    return people
      .filter(p => p.id !== collector.id)
      .map(p => {
        const balance = balances.get(p.id) ?? 0;
        return balance < 0
          ? { from: p.name, to: collector.name, amount: -balance }
          : { from: collector.name, to: p.name, amount: balance };
      })
      .filter(t => t.amount > 0.5);
  }, [collector, people]);

  const transfers = serverTransfers ?? localTransfers;

  function updatePerson(id: number, patch: Partial<Person>) {
    setPeople(list => list.map(p => p.id === id ? { ...p, ...patch } : p));
    setServerTransfers(null);
    if (patch.name !== undefined) void mutate({ action: "updatePerson", personId: id, name: patch.name });
  }

  function updateExpense(personId: number, expenseId: number, patch: Partial<Expense>) {
    setPeople(list => list.map(p => p.id === personId ? { ...p, expenses: p.expenses.map(e => e.id === expenseId ? { ...e, ...patch } : e) } : p));
    setServerTransfers(null);
    if (patch.label !== undefined) void mutate({ action: "updateExpense", expenseId, field: "label", value: patch.label });
    if (patch.amount !== undefined) void mutate({ action: "updateExpense", expenseId, field: "amount", value: patch.amount });
  }

  function addExpense(personId: number) {
    const id = newNumericId();
    const participantIds = people.map(person => person.id);
    setPeople(list => list.map(p => p.id === personId ? { ...p, expenses: [...p.expenses, { id, label: "", amount: 0, splitWith: participantIds }] } : p));
    setServerTransfers(null);
    void mutate({ action: "addExpense", personId, expenseId: id, participantIds });
  }

  function removeExpense(personId: number, expenseId: number) {
    setPeople(list => list.map(p => p.id === personId ? { ...p, expenses: p.expenses.filter(e => e.id !== expenseId) } : p));
    setServerTransfers(null);
    void mutate({ action: "deleteExpense", expenseId });
  }

  function addPerson() {
    const id = newNumericId();
    const name = `Người ${people.length + 1}`;
    setPeople(list => [...list, { id, name, expenses: [] }]);
    void mutate({ action: "addPerson", personId: id, name });
  }

  function removePerson(id: number) {
    if (people.length <= 2) return;
    const next = people.filter(p => p.id !== id).map(person => ({ ...person, expenses: person.expenses.map(expense => {
      const splitWith = expense.splitWith.filter(personId => personId !== id);
      return { ...expense, splitWith: splitWith.length ? splitWith : [person.id] };
    }) }));
    setPeople(next);
    if (collectorId === id) setCollectorId(next[0].id);
    setServerTransfers(null);
    void mutate({ action: "deletePerson", personId: id });
  }

  function toggleParticipant(expenseId: number, personId: number) {
    const expense = people.flatMap(person => person.expenses).find(item => item.id === expenseId);
    if (!expense) return;
    const selected = expense.splitWith.includes(personId);
    if (selected && expense.splitWith.length === 1) { setToast("Một khoản chi cần ít nhất một người"); window.setTimeout(() => setToast(""), 1600); return; }
    const updatedIds = selected ? expense.splitWith.filter(id => id !== personId) : [...expense.splitWith, personId];
    setPeople(list => list.map(person => ({ ...person, expenses: person.expenses.map(item => item.id === expenseId ? { ...item, splitWith: updatedIds } : item) })));
    setServerTransfers(null);
    void mutate({ action: "updateExpenseParticipants", expenseId, participantIds: updatedIds });
  }

  function selectCollector(id: number) {
    setCollectorId(id); setServerTransfers(null);
    void mutate({ action: "selectCollector", personId: id });
  }

  function renameTrip(name: string) {
    setTripName(name);
    void mutate({ action: "renameGroup", name });
  }

  async function shareGroup() {
    setShareLoading(true);
    try {
      let id = groupId;
      if (!id) {
        const response = await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tripName, collectorId, people }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        id = data.id; setGroupId(id); lastServerUpdate.current = data.updatedAt; setSyncState("synced");
      }
      if (!groupRoute) { window.location.assign(`/g/${id}`); return; }
      const url = `${window.location.origin}/g/${id}`;
      await navigator.clipboard.writeText(url);
      setToast("Đã sao chép link — gửi cho cả nhóm nhé!");
      window.setTimeout(() => setToast(""), 2200);
    } catch { setToast("Chưa thể tạo link, hãy thử lại"); }
    finally { setShareLoading(false); }
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

  if (!groupRoute) {
    return <main className="home-start">
      <header className="home-header">
        <div className="brand"><span className="brand-mark">c</span><span>chia<span>nhanh</span></span></div>
        <span className="home-note">Miễn phí · Không cần đăng nhập</span>
      </header>
      <section className="home-hero">
        <div className="eyebrow"><span></span> Chia tiền nhóm, không chia tình bạn</div>
        <h1>Mỗi cuộc vui,<br/><em>một phép chia nhẹ nhàng.</em></h1>
        <p>Ghi lại ai đã chi gì, chọn chính xác người tham gia từng khoản và để ChiaNhanh tính luồng chuyển tiền gọn nhất qua một người trung gian.</p>
        <button onClick={shareGroup} disabled={shareLoading}>{shareLoading ? "Đang tạo link…" : "Chia tiền"}<span>→</span></button>
      </section>
      <section className="home-features" aria-label="Điểm nổi bật">
        <div><span>01</span><b>Chia đúng người</b><p>Mỗi khoản có thể áp dụng cho một người, vài người hoặc cả nhóm.</p></div>
        <div><span>02</span><b>Cùng nhau nhập</b><p>Một đường link riêng để mọi người cập nhật chung một danh sách.</p></div>
        <div><span>03</span><b>Chuyển thật gọn</b><p>Chọn người trung gian, app tự tính chính xác ai chuyển cho ai.</p></div>
      </section>
      <footer className="home-footer"><span>Chia minh bạch.</span><p>Giữ cuộc vui nhẹ tênh.</p></footer>
    </main>;
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark">c</span><span>chia<span>nhanh</span></span></a>
        <div className="header-actions">
          {groupId && <span className={`sync-status ${syncState}`}><i></i>{syncState === "saving" ? "Đang lưu" : syncState === "loading" ? "Đang tải" : syncState === "error" ? "Mất kết nối" : "Đã đồng bộ"}</span>}
          <button className="share-button" onClick={shareGroup} disabled={shareLoading || !groupId}>{shareLoading || !groupId ? "Đang tải…" : "↗ Sao chép link"}</button>
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span></span> Chia tiền nhóm, không chia tình bạn</div>
        <input className="trip-title" value={tripName} onChange={e => renameTrip(e.target.value)} aria-label="Tên chuyến đi" />
        <p>{groupId ? "Mọi người trong nhóm có thể nhập cùng lúc — thay đổi được tự động đồng bộ." : "Thêm chi tiêu, chọn người trung gian, rồi chia sẻ link để cả nhóm cùng nhập."}</p>
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
                    <div className="expense-block" key={expense.id}>
                    <div className="expense-row">
                      <input placeholder="Tên khoản chi" value={expense.label} onChange={e => updateExpense(person.id, expense.id, { label: e.target.value })} aria-label="Tên khoản chi" />
                      <div className="amount-field"><input inputMode="numeric" value={expense.amount || ""} placeholder="0" onChange={e => updateExpense(person.id, expense.id, { amount: Number(e.target.value.replace(/\D/g, "")) })} aria-label="Số tiền" /><span>₫</span></div>
                      <button
                        className={`split-trigger ${expense.splitWith.length < people.length ? "partial" : ""}`}
                        onClick={() => setOpenSplitId(openSplitId === expense.id ? null : expense.id)}
                        aria-expanded={openSplitId === expense.id}
                        aria-label={`Chia cho ${expense.splitWith.length === people.length ? "cả nhóm" : `${expense.splitWith.length} người`}`}
                        title={`Chia cho ${expense.splitWith.length === people.length ? "cả nhóm" : `${expense.splitWith.length} người`}`}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      </button>
                      <button className="remove" onClick={() => removeExpense(person.id, expense.id)} aria-label="Xóa khoản chi">×</button>
                    </div>
                    {openSplitId === expense.id && <div className="split-panel"><div><b>Chia khoản này cho ai?</b><button onClick={() => setOpenSplitId(null)}>Xong</button></div><div className="split-options">{people.map(member => <label className={expense.splitWith.includes(member.id) ? "checked" : ""} key={member.id}><input type="checkbox" checked={expense.splitWith.includes(member.id)} onChange={() => toggleParticipant(expense.id, member.id)} /><span>✓</span>{member.name}</label>)}</div></div>}
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
                  <input type="radio" name="collector" checked={person.id === collectorId} onChange={() => selectCollector(person.id)} />
                  <span className="radio-dot"></span><span className="mini-avatar">{person.name.slice(0, 1).toUpperCase()}</span><b>{person.name}</b>
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
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
      <footer><span><b>c</b> chia<span>nhanh</span></span><p>Tính minh bạch. Chuyển nhẹ nhàng.</p></footer>
    </main>
  );
}
