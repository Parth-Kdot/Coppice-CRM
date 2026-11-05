import type { Metadata, Viewport } from "next";
import { Libre_Caslon_Text, Public_Sans } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

// Display: Libre Caslon Text, a printer's Caslon that suits a book of record. UI and data: Public
// Sans, a plain grotesque with tabular figures. Both are self-hosted by next/font at build time.
const caslon = Libre_Caslon_Text({
  variable: "--font-caslon",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const publicSans = Public_Sans({
  variable: "--font-public",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Coppice | A shared outreach pipeline for teams that turn over every year", template: "%s | Coppice" },
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
    <html lang="en" className={`${caslon.variable} ${publicSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
