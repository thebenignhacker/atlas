"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Compass,
  LayoutGrid,
  ListChecks,
  Settings,
  Sparkles,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Portfolio", icon: LayoutGrid, ownerOnly: false },
  { href: "/todos", label: "Todos", icon: ListChecks, ownerOnly: true },
  { href: "/activity", label: "Activity", icon: Activity, ownerOnly: false },
  { href: "/digest", label: "AI Digest", icon: Sparkles, ownerOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, ownerOnly: true },
];

export function Sidebar({ publicMode = false }: { publicMode?: boolean }) {
  const pathname = usePathname();
  const nav = publicMode ? NAV.filter((n) => !n.ownerOnly) : NAV;

  return (
    <aside className="fixed inset-x-0 bottom-0 z-20 flex h-14 items-center gap-1 border-t border-line bg-surface-1/95 px-2 backdrop-blur md:inset-y-0 md:left-0 md:h-auto md:w-60 md:flex-col md:items-stretch md:gap-0 md:border-t-0 md:border-r md:px-0">
      <Link
        href="/"
        className="hidden items-center gap-2 px-5 py-5 md:flex"
        aria-label="Atlas home"
      >
        <Compass className="h-5 w-5 text-teal" strokeWidth={2.2} />
        <span className="text-base font-semibold tracking-tight text-text">
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
                "flex flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors md:flex-row md:gap-2.5 md:px-3 md:py-2 md:text-sm",
                active
                  ? "bg-surface-3 text-text"
                  : "text-muted hover:bg-surface-2 hover:text-text",
              ].join(" ")}
            >
              <Icon
                className={`h-4.5 w-4.5 ${active ? "text-teal" : ""}`}
                strokeWidth={2}
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden px-5 py-4 text-[11px] text-faint md:block">
        {publicMode ? (
          <a
            href="https://github.com/thebenignhacker/atlas"
            target="_blank"
            rel="noreferrer"
            className="hover:text-text"
          >
            public demo · built with Atlas
          </a>
        ) : (
          "local-first · your data stays here"
        )}
      </div>
    </aside>
  );
}
