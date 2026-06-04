"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Compass,
  History,
  LayoutGrid,
  ListChecks,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Portfolio", icon: LayoutGrid, ownerOnly: false },
  { href: "/context", label: "Context", icon: ShieldCheck, ownerOnly: false },
  { href: "/sessions", label: "Sessions", icon: History, ownerOnly: true },
  { href: "/todos", label: "Todos", icon: ListChecks, ownerOnly: true },
  { href: "/activity", label: "Activity", icon: Activity, ownerOnly: false },
  { href: "/digest", label: "AI Digest", icon: Sparkles, ownerOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, ownerOnly: true },
];

export function Sidebar({ mode = "local" }: { mode?: "local" | "public" | "owner" }) {
  const pathname = usePathname();
  const publicMode = mode === "public";
  const nav = publicMode ? NAV.filter((n) => !n.ownerOnly) : NAV;

  return (
    <aside className="fixed inset-x-0 bottom-0 z-20 flex h-14 items-center gap-1 border-t border-line bg-surface-1/90 px-2 backdrop-blur-md md:inset-y-0 md:left-0 md:h-auto md:w-60 md:flex-col md:items-stretch md:gap-0 md:border-t-0 md:border-r md:bg-surface-1/70 md:px-0">
      <Link
        href="/"
        className="hidden items-center gap-2.5 px-6 py-6 md:flex"
        aria-label="Atlas home"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-text text-base">
          <Compass className="h-4.5 w-4.5 text-surface-1" strokeWidth={2.4} />
        </span>
        <span className="font-display text-2xl font-semibold leading-none tracking-tight text-text">
          Atlas
        </span>
      </Link>

      <nav className="flex flex-1 items-center justify-around gap-1 md:flex-col md:items-stretch md:justify-start md:gap-0.5 md:px-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={[
                "group relative flex flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all md:flex-row md:gap-2.5 md:px-3 md:py-2 md:text-sm",
                active
                  ? "bg-surface-2 text-text"
                  : "text-muted hover:bg-surface-2/60 hover:text-text",
              ].join(" ")}
            >
              {active && (
                <span className="absolute left-0 top-1/2 hidden h-5 w-[3px] -translate-y-1/2 rounded-full bg-clay md:block" />
              )}
              <Icon
                className={`h-4.5 w-4.5 transition-colors ${active ? "text-clay" : "text-faint group-hover:text-muted"}`}
                strokeWidth={2}
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden px-6 py-5 text-[11px] leading-relaxed text-faint md:block">
        {mode === "public" ? (
          <a
            href="https://github.com/thebenignhacker/atlas"
            target="_blank"
            rel="noreferrer"
            className="hover:text-text"
          >
            public demo · built with Atlas
          </a>
        ) : mode === "owner" ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-fresh" />
            owner view · signed in
          </span>
        ) : (
          "local-first · your data stays here"
        )}
      </div>
    </aside>
  );
}
