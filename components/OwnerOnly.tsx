import Link from "next/link";
import { Lock } from "lucide-react";

/** Shown when an owner-only view is requested in the public demo. */
export function OwnerOnly({ feature }: { feature: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-5 text-center">
      <Lock className="mb-4 h-9 w-9 text-faint" strokeWidth={1.5} />
      <h2 className="text-lg font-semibold text-text">{feature} is private</h2>
      <p className="mt-2 max-w-md text-sm text-muted">
        This is a public demo. {feature} and other private data are only visible to the
        owner running Atlas locally.
      </p>
      <Link href="/" className="mt-5 text-sm text-teal hover:underline">
        Back to the portfolio
      </Link>
    </div>
  );
}
