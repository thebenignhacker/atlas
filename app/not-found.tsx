import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";

// The root layout's title template applies here as it does to a deeper page,
// for an unknown route and for notFound() inside a route alike.
export const metadata: Metadata = { title: "Page not found" };

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
