import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Space Grotesk 2.000 с кириллицей (SIL OFL 1.1), шрифт брендбука ASDIC™
const grotesk = localFont({ src: "../fonts/SpaceGrotesk-Regular.woff2", weight: "400", variable: "--font-grotesk", display: "swap" });

export const metadata: Metadata = {
  title: "ASDIC™ · путь из точки A в точку B",
  description: "Платформа для прохождения методики ASDIC™ с помощью ИИ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={grotesk.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
