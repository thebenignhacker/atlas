import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Compass } from "lucide-react";
import { atlasMode, authControlsEnabled } from "@/lib/mode";
import { safeRedirectPath } from "@/lib/owner-auth/redirect";

export const dynamic = "force-dynamic";
const SUBTITLE = "This view shows full, private data. Enter the owner password to continue.";

// Behind the same check as the page: a static export would reach the browser
// with the not-found answer and title its tab "Owner access".
export async function generateMetadata(): Promise<Metadata> {
  if (!authControlsEnabled(atlasMode())) notFound();
  return { title: "Owner access", description: SUBTITLE };
}

const ERRORS: Record<string, string> = {
  bad: "Incorrect password.",
  rate: "Too many attempts. Wait a few minutes and try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  // Public and local modes have nothing to sign in to: the page does not exist
  // there, by the same check that hides the sidebar's login link.
  if (!authControlsEnabled(atlasMode())) notFound();
  const sp = await searchParams;
  const error = sp.error ? ERRORS[sp.error] ?? "Sign-in failed." : null;
  const callbackUrl = safeRedirectPath(sp.callbackUrl);

  return (
    <div className="grid min-h-screen place-items-center bg-surface-1 px-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-text">
            <Compass className="h-4.5 w-4.5 text-surface-1" strokeWidth={2.4} />
          </span>
          <span className="font-display text-2xl font-semibold tracking-tight text-text">
            Atlas
          </span>
        </div>

        <h1 className="font-display text-xl font-semibold text-text">Owner access</h1>
        <p className="mt-1 text-sm text-muted">{SUBTITLE}</p>

        {error && (
          <div className="mt-4 rounded-[var(--radius-card)] border border-clay/40 bg-clay/[0.06] px-3 py-2 text-[13px] text-clay">
            {error}
          </div>
        )}

        <form method="POST" action="/api/login" className="mt-5 space-y-3">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <input
            type="password"
            name="password"
            autoFocus
            required
            autoComplete="current-password"
            placeholder="Password"
            className="w-full rounded-[var(--radius-card)] border border-line bg-surface-2/40 px-3.5 py-2.5 text-sm text-text outline-none focus:border-line-strong"
          />
          <button
            type="submit"
            className="w-full rounded-[var(--radius-card)] bg-text px-3.5 py-2.5 text-sm font-medium text-surface-1 transition-opacity hover:opacity-90"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
