import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BoilerPitch",
  description: "Shared sponsorship pipeline for Purdue student orgs",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request. The Content-Security-Policy (proxy.ts) gives each request a
  // new nonce, and a page built ahead of time would carry scripts without it, which the browser
  // would then block.
  await connection();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
