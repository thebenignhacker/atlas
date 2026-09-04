import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { atlasMode } from "@/lib/mode";
import { getRequestMode } from "@/lib/request-mode";

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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Per-request mode: in a "unified" deployment this is "owner" only for a signed-in
  // request, else "public". The Sidebar shows the owner nav + a sign-out only when
  // genuinely authenticated; otherwise an owner-login link (when auth is enabled).
  const mode = await getRequestMode();
  // Sign-in/sign-out controls exist wherever a session cookie is in play: the
  // unified deployment (public + owner behind one login) and the standalone
  // owner deployment (every route behind the proxy gate). Without the second
  // case an owner-mode user could log in but never sign out from the UI.
  const authEnabled = atlasMode() === "unified" || atlasMode() === "owner";
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <Sidebar mode={mode} authEnabled={authEnabled} />
          <main className="flex-1 min-w-0 pl-14 md:pl-60">{children}</main>
        </div>
      </body>
    </html>
  );
}
