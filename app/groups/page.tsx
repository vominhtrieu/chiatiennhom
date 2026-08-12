import type { Metadata } from "next";
import { getDb } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Danh sách nhóm — ChiaNhanh",
  robots: { index: false, follow: false },
};

type GroupSummary = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastViewedAt: number | null;
  peopleCount: number;
  expenseCount: number;
  totalAmount: number;
};

const money = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const dateTime = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

function getGroups() {
  return getDb().prepare(`
    SELECT
      g.id,
      g.name,
      g.created_at AS createdAt,
      g.updated_at AS updatedAt,
      g.last_viewed_at AS lastViewedAt,
      (SELECT COUNT(*) FROM people p WHERE p.group_id = g.id) AS peopleCount,
      (SELECT COUNT(*) FROM expenses e WHERE e.group_id = g.id) AS expenseCount,
      (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.group_id = g.id) AS totalAmount
    FROM groups g
    ORDER BY g.updated_at DESC
  `).all() as GroupSummary[];
}

export default function GroupsPage() {
  const groups = getGroups();

  return (
    <main className="groups-page">
      <header className="topbar groups-topbar">
        <a className="brand" href="/"><span className="brand-mark">c</span><span>chia<span>nhanh</span></span></a>
        <span className="groups-count">{groups.length} nhóm</span>
      </header>

      <section className="groups-content">
        <div className="groups-heading">
          <div className="eyebrow">Danh sách nội bộ</div>
          <h1>Toàn bộ nhóm</h1>
          <p>Các nhóm được sắp xếp theo lần cập nhật gần nhất.</p>
        </div>

        {groups.length === 0 ? (
          <div className="groups-empty">
            <span>∅</span>
            <strong>Chưa có nhóm nào</strong>
            <p>Nhóm mới sẽ xuất hiện tại đây sau khi được tạo.</p>
          </div>
        ) : (
          <div className="groups-table-wrap">
            <table className="groups-table">
              <thead>
                <tr>
                  <th>Nhóm</th>
                  <th>Thành viên</th>
                  <th>Khoản chi</th>
                  <th>Tổng chi</th>
                  <th>Cập nhật</th>
                  <th>Xem gần nhất</th>
                  <th><span className="sr-only">Mở nhóm</span></th>
                </tr>
              </thead>
              <tbody>
                {groups.map(group => (
                  <tr key={group.id}>
                    <td>
                      <a className="group-name-link" href={`/g/${group.id}`}>{group.name}</a>
                      <code>{group.id}</code>
                    </td>
                    <td>{group.peopleCount} người</td>
                    <td>{group.expenseCount}</td>
                    <td><strong>{money.format(group.totalAmount)}</strong></td>
                    <td>
                      <time dateTime={new Date(group.updatedAt).toISOString()}>{dateTime.format(group.updatedAt)}</time>
                      <small>Tạo {dateTime.format(group.createdAt)}</small>
                    </td>
                    <td>
                      {group.lastViewedAt ? (
                        <time dateTime={new Date(group.lastViewedAt).toISOString()}>{dateTime.format(group.lastViewedAt)}</time>
                      ) : (
                        <span className="not-viewed">Chưa từng xem</span>
                      )}
                    </td>
                    <td><a className="group-open-link" href={`/g/${group.id}`} aria-label={`Mở nhóm ${group.name}`}>→</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
