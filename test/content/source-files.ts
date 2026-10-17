import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every file under `dir`, at any depth, whose name matches `keep`. */
export function filesUnder(dir: string, keep: RegExp = /./): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, keep));
    else if (keep.test(name)) out.push(p);
  }
  return out;
}
