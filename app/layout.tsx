import type { Metadata } from "next";
import { headers } from "next/headers";
import { Be_Vietnam_Pro, Manrope } from "next/font/google";
import "./globals.css";

const sans = Be_Vietnam_Pro({ variable: "--font-sans", subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700", "800"] });
const display = Manrope({ variable: "--font-display", subsets: ["latin", "vietnamese"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  return {
    metadataBase: base,
    title: "ChiaNhanh — Chia tiền nhóm thật nhẹ nhàng",
    description: "Ứng dụng chia chi phí nhóm với một người trung gian nhận và chuyển tiền.",
    icons: { icon: "/favicon.svg" },
    openGraph: { title: "ChiaNhanh", description: "Chia tiền nhóm, không chia tình bạn", images: [{ url: new URL("/og.png", base).toString(), width: 1792, height: 928 }] },
    twitter: { card: "summary_large_image", title: "ChiaNhanh", description: "Chia tiền nhóm, không chia tình bạn", images: [new URL("/og.png", base).toString()] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body className={`${sans.variable} ${display.variable}`}>{children}</body></html>;
}
