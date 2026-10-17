"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";

/** How far one press extends the list: a fixed count, or the next count given the current one. */
export type ShowMoreStep = number | ((shown: number) => number);

/**
 * Renders the first `initial` of `total` items through `children(shown)`, followed by a
 * button that reveals the next `step` (everything left when `step` is omitted). The
 * button names how many it adds and disappears once the whole list is on screen.
 */
export function ShowMore({
  total,
  initial,
  step,
  noun,
  children,
}: {
  total: number;
  initial: number;
  step?: ShowMoreStep;
  /** Plural noun for the counted items, e.g. "repos". */
  noun: string;
  children: (shown: number) => ReactNode;
}) {
  const [requested, setRequested] = useState(initial);
  const [pressed, setPressed] = useState(false);
  const refocus = useRef(false);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const shown = Math.max(0, Math.min(requested, total));
  const target =
    step === undefined ? total : typeof step === "number" ? shown + step : step(shown);
  // Always advance by at least one item so the button can never be a no-op.
  const next = Math.min(total, Math.max(target, shown + 1));

  // The last press removes the button; move focus to the line that replaces it so a
  // keyboard user carries on from here instead of from the top of the page.
  useEffect(() => {
    if (refocus.current && shown >= total) {
      refocus.current = false;
      doneRef.current?.focus();
    }
  }, [shown, total]);

  return (
    <div>
      {children(shown)}
      {pressed && shown >= total && (
        <p ref={doneRef} tabIndex={-1} className="mt-4 text-[11px] text-faint tnum outline-none">
          All {total} {noun} shown
        </p>
      )}
      {shown < total && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button
            type="button"
            onClick={() => {
              refocus.current = next >= total;
              setPressed(true);
              setRequested(next);
            }}
            className="inline-flex items-center rounded-lg border border-line bg-surface-1 px-3 py-2 text-[12.5px] font-medium text-muted transition-colors hover:border-line-strong hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            {next >= total ? `Show all ${total} ${noun}` : `Show ${next - shown} more ${noun}`}
          </button>
          <span className="text-[11px] text-faint tnum">
            {shown} of {total} shown
          </span>
        </div>
      )}
    </div>
  );
}

/** ShowMore for a list rendered on the server: the items arrive as children. */
export function ShowMoreList({
  initial,
  step,
  noun,
  className,
  children,
}: {
  initial: number;
  step?: number;
  noun: string;
  className?: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  return (
    <ShowMore total={items.length} initial={initial} step={step} noun={noun}>
      {(shown) => <div className={className}>{items.slice(0, shown)}</div>}
    </ShowMore>
  );
}
