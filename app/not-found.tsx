import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";

// Whole title: an unknown route renders this file in the root layout's own
// folder, where the layout's title template does not apply.
export const metadata: Metadata = { title: { absolute: "Page not found · Atlas" } };

/** Shown inside the app shell for an unknown route or repository slug. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-5 text-center">
      <SearchX className="mb-4 h-9 w-9 text-faint" strokeWidth={1.5} />
      <h1 className="text-lg font-semibold text-text">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        This page or repository does not exist in this portfolio.
      </p>
      <Link href="/" className="mt-5 text-sm text-teal hover:underline">
        Back to the portfolio
      </Link>
    </div>
  );
}
