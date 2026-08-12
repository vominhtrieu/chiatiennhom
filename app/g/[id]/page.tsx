import type { Metadata } from "next";
import { getDb } from "@/db";
import Home from "../../page";

type GroupPageProps = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: GroupPageProps): Promise<Metadata> {
  const { id } = await params;
  const group = getDb().prepare("SELECT name FROM groups WHERE id = ?").get(id) as { name: string } | undefined;
  const groupName = group?.name.trim() || "Nhóm chia tiền";
  const title = `${groupName} — ChiaNhanh`;
  const description = `Cùng nhập chi phí và chia tiền minh bạch cho nhóm ${groupName}.`;

  return {
    title,
    description,
    alternates: { canonical: `/g/${id}` },
    openGraph: {
      type: "website",
      locale: "vi_VN",
      siteName: "ChiaNhanh",
      url: `/g/${id}`,
      title,
      description,
      images: [{
        url: "/og.png",
        width: 1792,
        height: 928,
        alt: "ChiaNhanh — Chia tiền nhóm, không chia tình bạn",
      }],
    },
  };
}

export default async function GroupPage({ params }: GroupPageProps) {
  const { id } = await params;
  getDb().prepare("UPDATE groups SET last_viewed_at = ? WHERE id = ?").run(Date.now(), id);
  return <Home groupRoute />;
}
