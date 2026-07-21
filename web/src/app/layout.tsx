import type { Metadata } from "next";
import {
  JetBrains_Mono,
  Plus_Jakarta_Sans,
  Sora,
} from "next/font/google";
import "./globals.css";

/** Body UI — highly readable geometric sans at 16px+ */
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

/** Display / titles */
const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SearchEngine — AI Research Workspace",
  description:
    "Dataset search and web research with BM25 hybrid retrieval and cited answers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: browser extensions often inject attributes on
    // <html>/<body> (e.g. __processed_*=true) before React hydrates, which
    // otherwise surfaces as a noisy mismatch in dev.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${plusJakarta.variable} ${sora.variable} ${jetbrains.variable} min-h-dvh antialiased`}
        suppressHydrationWarning
      >
        <div className="page-mesh" aria-hidden />
        {children}
      </body>
    </html>
  );
}
