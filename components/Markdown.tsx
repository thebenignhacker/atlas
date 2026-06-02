import React from "react";

/** Tiny markdown renderer — headings, bullets, bold. No deps, no HTML injection. */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flushList = (key: number) => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${key}`} className="my-2 space-y-1.5 pl-1">
        {list.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-muted">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal" />
            <span>{inline(item)}</span>
          </li>
        ))}
      </ul>
    );
    list = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^#{1,3}\s/.test(line)) {
      flushList(idx);
      const text = line.replace(/^#{1,3}\s/, "");
      blocks.push(
        <h3
          key={idx}
          className="mt-5 mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text first:mt-0"
        >
          {text}
        </h3>
      );
    } else if (/^[-*]\s/.test(line)) {
      list.push(line.replace(/^[-*]\s/, ""));
    } else if (line.trim() === "") {
      flushList(idx);
    } else {
      flushList(idx);
      blocks.push(
        <p key={idx} className="my-1.5 text-sm leading-relaxed text-muted">
          {inline(line)}
        </p>
      );
    }
  });
  flushList(lines.length);

  return <div>{blocks}</div>;
}

function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return (
        <strong key={i} className="font-semibold text-text">
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith("`") && p.endsWith("`"))
      return (
        <code key={i} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[12px] text-teal">
          {p.slice(1, -1)}
        </code>
      );
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}
