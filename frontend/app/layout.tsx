import type { Metadata } from "next";
import { Noto_Kufi_Arabic } from "next/font/google";
import "./globals.css";

// Noto Kufi Arabic gives a more \"حكومي\" / رسمي feel suitable for dashboards.
const notoKufiArabic = Noto_Kufi_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-app",
});

export const metadata: Metadata = {
  title: "نوبكو لإدارة الحدود",
  description: "منصة إدارة الحدود القصوى للأقسام في المستشفيات",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${notoKufiArabic.className} ${notoKufiArabic.variable} antialiased`}>{children}</body>
    </html>
  );
}
