import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFreshness, isExpired } from "@/lib/context/store";

// The freshness function is the trust core. If this table is wrong, the store
// silently misleads — exactly the failure it exists to prevent.

const base = {
  hasProvenance: true,
  driftedCount: 0,
  verifyResult: null as "pass" | "fail" | "unknown" | null,
  lastVerifiedAt: new Date().toISOString(),
  staleAfterDays: null as number | null,
};

test("provenance present, nothing wrong => fresh", () => {
  assert.equal(computeFreshness(base), "fresh");
});

test("any drift => drifted (strongest signal, wins over everything)", () => {
  assert.equal(
    computeFreshness({ ...base, driftedCount: 1, verifyResult: "fail" }),
    "drifted"
  );
});

test("verify failed (no drift) => stale", () => {
  assert.equal(computeFreshness({ ...base, verifyResult: "fail" }), "stale");
});

test("past TTL (no drift, no fail) => expired", () => {
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  assert.equal(
    computeFreshness({ ...base, lastVerifiedAt: old, staleAfterDays: 30 }),
    "expired"
  );
});

test("no provenance and no passing verify => unverified (never fresh)", () => {
  assert.equal(
    computeFreshness({ ...base, hasProvenance: false, verifyResult: null }),
    "unverified"
  );
});

test("no provenance but verify passed and not expired => fresh", () => {
  assert.equal(
    computeFreshness({ ...base, hasProvenance: false, verifyResult: "pass" }),
    "fresh"
  );
});

test("drift beats expiry beats unverified ordering holds", () => {
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  // drifted + expired + no provenance -> drifted wins
  assert.equal(
    computeFreshness({
      hasProvenance: false,
      driftedCount: 2,
      verifyResult: "fail",
      lastVerifiedAt: old,
      staleAfterDays: 1,
    }),
    "drifted"
  );
});

test("isExpired: null TTL never expires", () => {
  const old = new Date(Date.now() - 9999 * 86_400_000).toISOString();
  assert.equal(isExpired(old, null), false);
});

test("isExpired: within window is not expired", () => {
  const recent = new Date(Date.now() - 1 * 86_400_000).toISOString();
  assert.equal(isExpired(recent, 30), false);
});
