import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Newsreader } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

// Display: Newsreader, a variable serif with an optical size axis (no soft or wonky axes exist in it).
// UI and data: Instrument Sans. Both are self-hosted by next/font at build time.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Coppice | A shared outreach pipeline for teams that turn over every year",
  description:
    "A shared outreach pipeline for student orgs and nonprofits. One officer claims each company, and the history stays when the board changes.",
};

export const viewport: Viewport = {
  themeColor: "#F6F1E6",
  colorScheme: "light",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request. The Content-Security-Policy (proxy.ts) gives each request a
  // new nonce, and a page built ahead of time would carry scripts without it, which the browser
  // would then block.
  await connection();
  return (
    <html lang="en" className={`${newsreader.variable} ${instrumentSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
