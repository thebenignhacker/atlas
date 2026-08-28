"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Compass,
  History,
  LayoutGrid,
  ListChecks,
  Map,
  Scale,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Zap,
  LogIn,
  LogOut,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Portfolio", icon: LayoutGrid, ownerOnly: false },
  { href: "/roadmap", label: "Roadmap", icon: Map, ownerOnly: true },
  { href: "/strategy", label: "Strategy", icon: Target, ownerOnly: true },
  { href: "/context", label: "Context", icon: ShieldCheck, ownerOnly: false },
  { href: "/usage", label: "Usage", icon: Zap, ownerOnly: false },
  { href: "/sessions", label: "Sessions", icon: History, ownerOnly: true },
  { href: "/session-board", label: "Session board", icon: Users, ownerOnly: true },
  { href: "/todos", label: "Todos", icon: ListChecks, ownerOnly: true },
  { href: "/decisions", label: "Decisions", icon: Scale, ownerOnly: true },
  { href: "/activity", label: "Activity", icon: Activity, ownerOnly: false },
  { href: "/digest", label: "AI Digest", icon: Sparkles, ownerOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, ownerOnly: true },
];

export function Sidebar({
  mode = "local",
  authEnabled = false,
}: {
  mode?: "local" | "public" | "owner";
  authEnabled?: boolean;
}) {
  const pathname = usePathname();
  const publicMode = mode === "public";
  const nav = publicMode ? NAV.filter((n) => !n.ownerOnly) : NAV;

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-14 flex-col items-stretch border-r border-line bg-surface-1/90 px-1.5 py-3 backdrop-blur-md md:w-60 md:gap-0 md:bg-surface-1/70 md:px-0 md:py-0">
      <Link
        href="/"
        className="flex items-center justify-center gap-2.5 py-2 md:justify-start md:px-6 md:py-6"
        aria-label="Atlas home"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-text text-base">
          <Compass className="h-4.5 w-4.5 text-surface-1" strokeWidth={2.4} />
        </span>
        <span className="hidden font-display text-2xl font-semibold leading-none tracking-tight text-text md:inline">
          Atlas
        </span>
      </Link>

      <nav className="mt-1 flex flex-1 flex-col items-stretch gap-1 md:mt-0 md:gap-0.5 md:px-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={[
                "group relative flex items-center justify-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-all md:justify-start md:px-3",
                active
                  ? "bg-surface-2 text-text"
                  : "text-muted hover:bg-surface-2/60 hover:text-text",
              ].join(" ")}
            >
              {active && (
                <span className="absolute left-0 top-1/2 hidden h-5 w-[3px] -translate-y-1/2 rounded-full bg-clay md:block" />
              )}
              <Icon
                className={`h-4.5 w-4.5 shrink-0 transition-colors ${active ? "text-clay" : "text-faint group-hover:text-muted"}`}
                strokeWidth={2}
              />
              <span className="hidden md:inline">{label}</span>
            </Link>
          );
        })}
      </nav>

      {authEnabled && (
        <div className="px-0 pb-1 md:px-3">
          {mode === "owner" ? (
            <form action="/api/logout" method="POST">
              <button
                type="submit"
                title="Sign out"
                className="flex w-full items-center justify-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2/60 hover:text-text md:justify-start md:px-3"
              >
                <LogOut className="h-4.5 w-4.5 shrink-0 text-faint" strokeWidth={2} />
                <span className="hidden md:inline">Sign out</span>
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              title="Owner login"
              className="flex items-center justify-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2/60 hover:text-text md:justify-start md:px-3"
            >
              <LogIn className="h-4.5 w-4.5 shrink-0 text-faint" strokeWidth={2} />
              <span className="hidden md:inline">Owner login</span>
            </Link>
          )}
        </div>
      )}

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
