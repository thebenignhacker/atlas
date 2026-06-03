import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Provenance } from "@/lib/types";

/**
 * Provenance fingerprinting. A card records the content hash of each source file
 * it was derived from; drift detection re-hashes those files and reports which
 * changed. We use a plain sha256 of the file bytes rather than the git HEAD SHA
 * (which moves on every unrelated commit) or mtime (reset by clone/checkout), so
 * a card drifts ONLY when its own sources change.
 */

/** Resolve a user-supplied source path to an absolute path against `cwd`. */
export function resolveSource(p: string, cwd: string = process.cwd()): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

/** sha256 of a file's bytes. Returns null if the file does not exist. */
export function hashFile(absPath: string): string | null {
  try {
    const buf = fs.readFileSync(absPath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Build provenance entries for a list of source paths. Throws if any path is
 * missing — a card must not be born pointing at a file that isn't there.
 */
export function captureProvenance(
  paths: string[],
  cwd: string = process.cwd()
): Provenance[] {
  const at = new Date().toISOString();
  return paths.map((p) => {
    const abs = resolveSource(p, cwd);
    const hash = hashFile(abs);
    if (hash === null) {
      throw new Error(`source file not found: ${p} (resolved: ${abs})`);
    }
    return { path: abs, hash, hashAlgo: "sha256" as const, capturedAt: at };
  });
}

/**
 * Re-hash each provenance file and return the paths whose content changed (or
 * which have gone missing). An empty array means no drift.
 */
export function detectDrift(provenance: Provenance[]): string[] {
  const drifted: string[] = [];
  for (const p of provenance) {
    const current = hashFile(p.path);
    if (current === null || current !== p.hash) drifted.push(p.path);
  }
  return drifted;
}
