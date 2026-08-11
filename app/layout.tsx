import type { Metadata } from "next";
import { headers } from "next/headers";
import { Be_Vietnam_Pro, Manrope } from "next/font/google";
import "./globals.css";

const sans = Be_Vietnam_Pro({ variable: "--font-sans", subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700", "800"] });
const display = Manrope({ variable: "--font-display", subsets: ["latin", "vietnamese"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:9999";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const title = "ChiaNhanh — Chia tiền nhóm thật nhẹ nhàng";
  const description = "Chia tiền nhóm, không chia tình bạn. Tạo nhóm, nhập chi phí và biết chính xác ai cần chuyển cho ai.";
  return {
    metadataBase: base,
    title,
    description,
    alternates: { canonical: base },
    icons: { icon: "/favicon.svg" },
    openGraph: {
      type: "website",
      locale: "vi_VN",
      siteName: "ChiaNhanh",
      url: base,
      title,
      description,
      images: [{
        url: new URL("/og.png", base).toString(),
        width: 1792,
        height: 928,
        alt: "ChiaNhanh — Chia tiền nhóm, không chia tình bạn",
      }],
    },
    twitter: { card: "summary_large_image", title, description, images: [new URL("/og.png", base).toString()] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body className={`${sans.variable} ${display.variable}`}>{children}</body></html>;
}
