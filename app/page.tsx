"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SplitMode = "equal" | "percent" | "amount";
type Expense = { id: number; label: string; amount: number; splitWith: number[]; splitMode: SplitMode; splitValues: Record<string, number> };
type Person = { id: number; name: string; expenses: Expense[] };
type Transfer = { from: string; to: string; amount: number };

const initialPeople: Person[] = [
  { id: 1, name: "Người 1", expenses: [] },
  { id: 2, name: "Người 2", expenses: [] },
];

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const newNumericId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

function distribute(total: number, ids: number[], decimals = 0) {
  if (!ids.length) return {};
  const factor = 10 ** decimals;
  const totalUnits = Math.max(0, Math.round(total * factor));
  const base = Math.floor(totalUnits / ids.length);
  let remainder = totalUnits - base * ids.length;
  return Object.fromEntries(ids.map(id => [id, (base + (remainder-- > 0 ? 1 : 0)) / factor]));
}

function splitTarget(mode: SplitMode, amount: number) {
  return mode === "percent" ? 100 : mode === "amount" ? amount : 0;
}

function defaultSplitValues(mode: SplitMode, amount: number, ids: number[]) {
  if (mode === "equal") return Object.fromEntries(ids.map(id => [id, 1]));
  return distribute(splitTarget(mode, amount), ids, mode === "percent" ? 2 : 0);
}

function scaleAmountValues(amount: number, ids: number[], current: Record<string, number>) {
  const currentTotal = ids.reduce((sum, id) => sum + Math.max(0, Number(current[id]) || 0), 0);
  if (currentTotal <= 0) return defaultSplitValues("amount", amount, ids);
  const target = Math.max(0, Math.round(amount));
  const raw = ids.map(id => Math.max(0, Number(current[id]) || 0) * target / currentTotal);
  const units = raw.map(Math.floor);
  let remainder = target - units.reduce((sum, value) => sum + value, 0);
  raw.map((value, index) => ({ index, fraction: value - units[index] }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(item => { if (remainder-- > 0) units[item.index] += 1; });
  return Object.fromEntries(ids.map((id, index) => [id, units[index]]));
}

function sharesForExpense(expense: Expense, ids: number[]) {
  if (expense.splitMode === "equal") {
    const values = distribute(expense.amount, ids);
    return ids.map(id => Number(values[id]) || 0);
  }
  const requested = ids.map(id => Math.max(0, expense.splitMode === "percent"
    ? expense.amount * (Number(expense.splitValues?.[id]) || 0) / 100
    : Number(expense.splitValues?.[id]) || 0));
  const requestedTotal = requested.reduce((sum, value) => sum + value, 0);
  return requestedTotal > 0
    ? requested.map(value => value * expense.amount / requestedTotal)
    : ids.map(() => expense.amount / ids.length);
}

export default function Home({ groupRoute = false }: { groupRoute?: boolean }) {
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [collectorId, setCollectorId] = useState(1);
  const [tripName, setTripName] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverTransfers, setServerTransfers] = useState<Transfer[] | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [syncState, setSyncState] = useState<"local" | "loading" | "saving" | "synced" | "error">(groupRoute ? "loading" : "local");
  const [toast, setToast] = useState("");
  const [openSplitId, setOpenSplitId] = useState<number | null>(null);
  const lastLocalChange = useRef(0);
  const lastServerUpdate = useRef(0);
  const saveTimers = useRef(new Map<string, number>());
  const activeSaves = useRef(0);

  useEffect(() => () => {
    saveTimers.current.forEach(timer => window.clearTimeout(timer));
    saveTimers.current.clear();
  }, []);

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
    lastLocalChange.current = Date.now();
    activeSaves.current += 1;
    setSyncState("saving");
    try {
      const response = await fetch(`/api/groups/${groupId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      lastServerUpdate.current = Math.max(lastServerUpdate.current, data.updatedAt);
    } catch { setSyncState("error"); }
    finally {
      activeSaves.current -= 1;
      if (activeSaves.current === 0 && saveTimers.current.size === 0) setSyncState(current => current === "error" ? current : "synced");
    }
  }

  function mutateDebounced(key: string, payload: Record<string, unknown>) {
    if (!groupId) return;
    const currentTimer = saveTimers.current.get(key);
    if (currentTimer !== undefined) window.clearTimeout(currentTimer);
    lastLocalChange.current = Date.now();
    setSyncState("saving");
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(key);
      void mutate(payload);
    }, 600);
    saveTimers.current.set(key, timer);
  }

  function cancelDebounced(prefix: string) {
    saveTimers.current.forEach((timer, key) => {
      if (!key.startsWith(prefix)) return;
      window.clearTimeout(timer);
      saveTimers.current.delete(key);
    });
  }

  const totals = useMemo(() => people.map(p => ({ ...p, total: p.expenses.reduce((s, e) => s + Number(e.amount || 0), 0) })), [people]);
  const grandTotal = totals.reduce((s, p) => s + p.total, 0);
  const collector = people.find(p => p.id === collectorId) ?? people[0];

  const localTransfers = useMemo<Transfer[]>(() => {
    if (!collector) return [];
    const balances = new Map(people.map(person => [person.id, 0]));
    for (const payer of people) {
      for (const expense of payer.expenses) {
        const participantIds = expense.splitWith?.filter(id => balances.has(id)) ?? people.map(person => person.id);
        if (!participantIds.length) continue;
        balances.set(payer.id, (balances.get(payer.id) ?? 0) + expense.amount);
        const shares = sharesForExpense(expense, participantIds);
        participantIds.forEach((id, index) => {
          balances.set(id, (balances.get(id) ?? 0) - shares[index]);
        });
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
    if (patch.name !== undefined) mutateDebounced(`person:${id}:name`, { action: "updatePerson", personId: id, name: patch.name });
  }

  function updateExpense(personId: number, expenseId: number, patch: Partial<Expense>) {
    const current = people.flatMap(person => person.expenses).find(expense => expense.id === expenseId);
    let splitValues = current?.splitValues;
    if (patch.amount !== undefined && current?.splitMode === "amount") {
      splitValues = scaleAmountValues(patch.amount, current.splitWith, current.splitValues);
      mutateDebounced(`expense:${expenseId}:participants`, { action: "updateExpenseParticipants", expenseId, participantIds: current.splitWith, mode: "amount", values: splitValues });
    }
    setPeople(list => list.map(p => p.id === personId ? { ...p, expenses: p.expenses.map(e => e.id === expenseId ? { ...e, ...patch, ...(splitValues ? { splitValues } : {}) } : e) } : p));
    setServerTransfers(null);
    if (patch.label !== undefined) mutateDebounced(`expense:${expenseId}:label`, { action: "updateExpense", expenseId, field: "label", value: patch.label });
    if (patch.amount !== undefined) mutateDebounced(`expense:${expenseId}:amount`, { action: "updateExpense", expenseId, field: "amount", value: patch.amount });
  }

  function addExpense(personId: number) {
    const id = newNumericId();
    const participantIds = people.map(person => person.id);
    const splitValues = defaultSplitValues("equal", 0, participantIds);
    setPeople(list => list.map(p => p.id === personId ? { ...p, expenses: [...p.expenses, { id, label: "", amount: 0, splitWith: participantIds, splitMode: "equal", splitValues }] } : p));
    setServerTransfers(null);
    void mutate({ action: "addExpense", personId, expenseId: id, participantIds });
  }

  function removeExpense(personId: number, expenseId: number) {
    cancelDebounced(`expense:${expenseId}:`);
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
    cancelDebounced(`person:${id}:`);
    people.find(person => person.id === id)?.expenses.forEach(expense => cancelDebounced(`expense:${expense.id}:`));
    people.flatMap(person => person.expenses).filter(expense => expense.splitWith.includes(id))
      .forEach(expense => cancelDebounced(`expense:${expense.id}:participants`));
    const next = people.filter(p => p.id !== id).map(person => ({ ...person, expenses: person.expenses.map(expense => {
      const splitWith = expense.splitWith.filter(personId => personId !== id);
      const nextSplitWith = splitWith.length ? splitWith : [person.id];
      const splitValues = defaultSplitValues(expense.splitMode, expense.amount, nextSplitWith);
      return { ...expense, splitWith: nextSplitWith, splitValues };
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
    const updatedValues = defaultSplitValues(expense.splitMode, expense.amount, updatedIds);
    cancelDebounced(`expense:${expenseId}:participants`);
    setPeople(list => list.map(person => ({ ...person, expenses: person.expenses.map(item => item.id === expenseId ? { ...item, splitWith: updatedIds, splitValues: updatedValues } : item) })));
    setServerTransfers(null);
    void mutate({ action: "updateExpenseParticipants", expenseId, participantIds: updatedIds, mode: expense.splitMode, values: updatedValues });
  }

  function changeSplitMode(expenseId: number, mode: SplitMode) {
    const expense = people.flatMap(person => person.expenses).find(item => item.id === expenseId);
    if (!expense) return;
    const splitValues = defaultSplitValues(mode, expense.amount, expense.splitWith);
    cancelDebounced(`expense:${expenseId}:participants`);
    setPeople(list => list.map(person => ({ ...person, expenses: person.expenses.map(item => item.id === expenseId ? { ...item, splitMode: mode, splitValues } : item) })));
    setServerTransfers(null);
    void mutate({ action: "updateExpenseParticipants", expenseId, participantIds: expense.splitWith, mode, values: splitValues });
  }

  function updateParticipantShare(expenseId: number, personId: number, value: string) {
    const expense = people.flatMap(person => person.expenses).find(item => item.id === expenseId);
    if (!expense || expense.splitMode === "equal" || !expense.splitWith.includes(personId)) return;
    const target = splitTarget(expense.splitMode, expense.amount);
    const parsed = expense.splitMode === "amount" ? Number(value.replace(/\D/g, "")) : Number(value.replace(",", "."));
    const nextValue = Math.min(target, Math.max(0, Number.isFinite(parsed) ? parsed : 0));
    const otherIds = expense.splitWith.filter(id => id !== personId);
    const otherValues = distribute(target - nextValue, otherIds, expense.splitMode === "percent" ? 2 : 0);
    const splitValues = { ...otherValues, [personId]: nextValue };
    setPeople(list => list.map(person => ({ ...person, expenses: person.expenses.map(item => item.id === expenseId ? { ...item, splitValues } : item) })));
    setServerTransfers(null);
    mutateDebounced(`expense:${expenseId}:participants`, { action: "updateExpenseParticipants", expenseId, participantIds: expense.splitWith, mode: expense.splitMode, values: splitValues });
  }

  function selectCollector(id: number) {
    setCollectorId(id); setServerTransfers(null);
    void mutate({ action: "selectCollector", personId: id });
  }

  function renameTrip(name: string) {
    setTripName(name);
    mutateDebounced("group:name", { action: "renameGroup", name });
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

  async function deleteGroup() {
    if (!groupId || deleteLoading) return;
    if (!window.confirm(`Xóa nhóm “${tripName}”? Toàn bộ thành viên và khoản chi sẽ bị xóa vĩnh viễn.`)) return;

    setDeleteLoading(true);
    saveTimers.current.forEach(timer => window.clearTimeout(timer));
    saveTimers.current.clear();
    try {
      const response = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.location.assign("/");
    } catch {
      setDeleteLoading(false);
      setToast("Không thể xóa nhóm, hãy thử lại");
      window.setTimeout(() => setToast(""), 2200);
    }
  }

  if (!groupRoute) {
    return <main className="home-start">
      <header className="home-header">
        <a className="brand" href="/"><span className="brand-mark">c</span><span>chia<span>nhanh</span></span></a>
        <span className="home-note">Miễn phí · Không cần đăng nhập</span>
      </header>
      <section className="home-hero">
        <div className="eyebrow">Chia tiền nhóm, không chia tình bạn</div>
        <h1>Mỗi cuộc vui,<br/><em>một phép chia nhẹ nhàng.</em></h1>
        <p>Ghi lại ai đã chi gì, chọn chính xác người tham gia từng khoản và để ChiaNhanh tính luồng chuyển tiền gọn nhất qua một người trung gian.</p>
        <div className="home-group-field">
          <input id="new-group-name" value={tripName} onChange={e => setTripName(e.target.value)} placeholder="Nhập tên nhóm" aria-label="Tên nhóm" autoComplete="off" />
        </div>
        <button onClick={shareGroup} disabled={shareLoading || !tripName.trim()}>{shareLoading ? "Đang tạo link…" : "Chia tiền"}<span>→</span></button>
      </section>
      <section className="home-features" aria-label="Điểm nổi bật">
        <div><span>01</span><b>Chia đúng người</b><p>Mỗi khoản có thể áp dụng cho một người, vài người hoặc cả nhóm.</p></div>
        <div><span>02</span><b>Cùng nhau nhập</b><p>Một đường link riêng để mọi người cập nhật chung một danh sách.</p></div>
        <div><span>03</span><b>Chuyển thật gọn</b><p>Chọn người trung gian, app tự tính chính xác ai chuyển cho ai.</p></div>
      </section>
      <footer className="home-footer"><span>Chia minh bạch.</span><p>Giữ cuộc vui nhẹ tênh.</p></footer>
    </main>;
  }

  if (syncState === "loading") {
    return <main className="group-loading-page">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark">c</span><span>chia<span>nhanh</span></span></a>
      </header>
      <section className="group-loading" role="status" aria-live="polite">
        <span className="loading-spinner" aria-hidden="true"></span>
        <strong>Đang tải dữ liệu nhóm…</strong>
        <p>Chờ một chút nhé.</p>
      </section>
    </main>;
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark">c</span><span>chia<span>nhanh</span></span></a>
        <div className="header-actions">
          {groupId && <span className={`sync-status ${syncState}`}><i></i>{syncState === "saving" ? "Đang lưu" : syncState === "error" ? "Mất kết nối" : "Đã đồng bộ"}</span>}
          <button className="share-button" onClick={shareGroup} disabled={shareLoading || !groupId}>{shareLoading || !groupId ? "Đang tải…" : "↗ Sao chép link"}</button>
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow">Chia tiền nhóm, không chia tình bạn</div>
        <input className="trip-title" value={tripName} onChange={e => renameTrip(e.target.value)} placeholder="Tên nhóm" aria-label="Tên nhóm" />
        <p>{groupId ? "Mọi người trong nhóm có thể nhập cùng lúc — thay đổi được tự động đồng bộ." : "Thêm chi tiêu, chọn người trung gian, rồi chia sẻ link để cả nhóm cùng nhập."}</p>
        <div className="stats">
          <div><span>Tổng chi</span><strong>{money.format(grandTotal)}</strong></div>
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
                    {openSplitId === expense.id && <div className="split-panel">
                      <div><span><b>Chia khoản này cho ai?</b><small>Chọn cách chia rồi nhập ngay cạnh từng người.</small></span><button onClick={() => setOpenSplitId(null)}>Xong</button></div>
                      <div className="split-mode" role="group" aria-label="Cách chia khoản chi">
                        <button className={expense.splitMode === "equal" ? "active" : ""} onClick={() => changeSplitMode(expense.id, "equal")}>Chia đều</button>
                        <button className={expense.splitMode === "percent" ? "active" : ""} onClick={() => changeSplitMode(expense.id, "percent")}>Theo %</button>
                        <button className={expense.splitMode === "amount" ? "active" : ""} onClick={() => changeSplitMode(expense.id, "amount")}>Số tiền</button>
                      </div>
                      <div className="split-options">{people.map(member => {
                        const selected = expense.splitWith.includes(member.id);
                        const participantIndex = expense.splitWith.indexOf(member.id);
                        const calculatedShare = selected ? sharesForExpense(expense, expense.splitWith)[participantIndex] : 0;
                        return <div className={`split-option ${selected ? "checked" : ""}`} key={member.id}>
                          <label><input type="checkbox" checked={selected} onChange={() => toggleParticipant(expense.id, member.id)} /><span>✓</span><b>{member.name}</b></label>
                          {selected && (expense.splitMode === "equal"
                            ? <span className="equal-share">{money.format(Math.round(calculatedShare))}</span>
                            : <div className={`share-field ${expense.splitMode}`}>
                                <input
                                  type="text"
                                  inputMode={expense.splitMode === "percent" ? "decimal" : "numeric"}
                                  value={expense.splitValues?.[member.id] ?? 0}
                                  onChange={event => updateParticipantShare(expense.id, member.id, event.target.value)}
                                  aria-label={`${expense.splitMode === "percent" ? "Phần trăm" : "Số tiền"} của ${member.name}`}
                                />
                                <span>{expense.splitMode === "percent" ? "%" : "₫"}</span>
                              </div>)}
                        </div>;
                      })}</div>
                    </div>}
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
            <button className="calculate" onClick={calculate} disabled={loading}>{loading ? "Đang tính…" : "Tính tiền"} <span>→</span></button>
            <button className="copy" onClick={copySummary}>{copied ? "✓ Đã sao chép" : "▣ Sao chép kết quả"}</button>
          </section>
          <div className="tip"><span>✦</span><p><b>Mẹo nhỏ</b>Chọn người có số dư lớn nhất làm trung gian để giảm số lần chuyển.</p></div>
          <button className="delete-group" onClick={deleteGroup} disabled={deleteLoading}>{deleteLoading ? "Đang xóa…" : "Xóa nhóm"}</button>
        </aside>
      </div>
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
      <footer><span><b>c</b> chia<span>nhanh</span></span><p>Tính minh bạch. Chuyển nhẹ nhàng.</p></footer>
    </main>
  );
}
