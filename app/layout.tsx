import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { NdkProvider } from "./providers";

// Body: clean neutral grotesque. Metadata/ledger: mono. Wordmark/labels: a
// warm old-style serif (Fraunces) — the civic "assembly" voice, used small.
const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
});

export const metadata: Metadata = {
  title: "moot.pub — where the community meets",
  description:
    "A Nostr-native discussion app. The floor on the left, the record on the right.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="h-full">
        <NdkProvider>{children}</NdkProvider>
      </body>
    </html>
  );
}
