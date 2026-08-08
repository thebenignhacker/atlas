import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { atlasMode, isSnapshotMode, isPublicMode, isOwnerMode } from "../../lib/mode.ts";

/**
 * atlasMode() must default to the LEAST privileged mode.
 *
 * Regression: the default branch used to return "local", the mode that reads the
 * unsanitized SQLite database. A deployment that forgot to set ATLAS_MODE would
 * try to serve owner data, and only `.vercelignore` excluding `data`/`*.db` kept
 * that from working — fail-safe by accident of an unrelated file, not by design.
 *
 * The two cases that matter here are "unset" and "unrecognised". Both returned
 * "local" before the fix; both must return "public" now.
 */
describe("atlasMode privilege default", () => {
  const original = process.env.ATLAS_MODE;

  beforeEach(() => { delete process.env.ATLAS_MODE; });
  afterEach(() => {
    if (original === undefined) delete process.env.ATLAS_MODE;
    else process.env.ATLAS_MODE = original;
  });

  test("unset ATLAS_MODE resolves to public, never local", () => {
    delete process.env.ATLAS_MODE;
    assert.equal(atlasMode(), "public");
    assert.notEqual(atlasMode(), "local");
  });

  test("an unrecognised ATLAS_MODE resolves to public, never local", () => {
    for (const bad of ["", "publik", "LOCAL", "Owner", "dev", "production", "0"]) {
      process.env.ATLAS_MODE = bad;
      assert.equal(atlasMode(), "public", `ATLAS_MODE=${JSON.stringify(bad)} must fall back to public`);
    }
  });

  test("every recognised mode still round-trips", () => {
    for (const mode of ["local", "public", "owner", "unified"] as const) {
      process.env.ATLAS_MODE = mode;
      assert.equal(atlasMode(), mode);
    }
  });

  test("local is reachable, but only by asking for it explicitly", () => {
    process.env.ATLAS_MODE = "local";
    assert.equal(atlasMode(), "local");
    assert.equal(isSnapshotMode(), false, "local reads SQLite, not a snapshot");
  });

  test("the derived helpers agree with the default", () => {
    delete process.env.ATLAS_MODE;
    assert.equal(isPublicMode(), true, "unset must read the sanitized snapshot");
    assert.equal(isOwnerMode(), false, "unset must never resolve to owner");
    assert.equal(isSnapshotMode(), true, "unset must not touch the SQLite DB");
  });
});
