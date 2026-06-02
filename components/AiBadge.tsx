import { Sparkles } from "lucide-react";

/** Marks content as LLM-generated. Purple = AI, per the design language. */
export function AiBadge({ label = "AI-generated" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-purple/15 px-1.5 py-0.5 text-[10px] font-medium text-purple">
      <Sparkles className="h-3 w-3" />
      {label}
    </span>
  );
}
