import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { atlasMode } from "@/lib/mode";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Editorial display face. Optical-size axis + a touch of contrast give Atlas a
// literary, magazine feel for headlines and oversized stat figures.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

export const metadata: Metadata = {
  title: "Atlas — your build, at a glance",
  description:
    "A local-first command center for builders shipping many projects with LLM coding tools.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <Sidebar mode={atlasMode()} />
          <main className="flex-1 min-w-0 md:pl-60">{children}</main>
        </div>
      </body>
    </html>
  );
}
