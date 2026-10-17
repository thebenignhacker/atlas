import { test } from "node:test";
import assert from "node:assert/strict";
import { safeRedirectPath, sameOriginPath, sameOriginUrl } from "@/lib/owner-auth/redirect";

// Guards the open-redirect fix: a naive `//` check is bypassable because the URL
// parser strips CR/LF/TAB, so "/<CR>//evil.com" resolves off-origin. Control
// chars are built by code point to avoid escaping them in this source.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const BS = String.fromCharCode(92); // backslash

test("safeRedirectPath keeps real same-origin paths", () => {
  assert.equal(safeRedirectPath("/usage"), "/usage");
  assert.equal(safeRedirectPath("/repo/x?q=1"), "/repo/x?q=1");
});

test("safeRedirectPath neutralizes off-origin payloads", () => {
  assert.equal(safeRedirectPath("//evil.com"), "/");
  assert.equal(safeRedirectPath("/" + CR + "//evil.com"), "/"); // CR-laced bypass
  assert.equal(safeRedirectPath("/" + LF + "//evil.com"), "/");
  assert.equal(safeRedirectPath("/" + TAB + "//evil.com"), "/");
  assert.equal(safeRedirectPath(BS + BS + "evil.com"), "/"); // backslash bypass
  assert.equal(safeRedirectPath("https://evil.com"), "/");
  assert.equal(safeRedirectPath("javascript:alert(1)"), "/");
  assert.equal(safeRedirectPath(null), "/");
  assert.equal(safeRedirectPath(undefined), "/");
});

test("sameOriginUrl never escapes the origin", () => {
  const origin = "https://atlas.example.com";
  assert.equal(sameOriginUrl("/usage", origin).origin, origin);
  assert.equal(sameOriginUrl("/usage", origin).pathname, "/usage");
  assert.equal(sameOriginUrl("//evil.com", origin).origin, origin);
  assert.equal(sameOriginUrl("/" + CR + "//evil.com", origin).origin, origin);
  assert.equal(sameOriginUrl("https://evil.com", origin).origin, origin);
});

// sameOriginPath feeds a RELATIVE Location, where a leading "//" is a
// scheme-relative URL to another host. Dot segments are removed during
// resolution, so "/.//evil.com" passes the string filter and resolves to the
// path "//evil.com".
test("sameOriginPath keeps same-origin paths with their query and fragment", () => {
  assert.equal(sameOriginPath("/usage"), "/usage");
  assert.equal(sameOriginPath("/repo/x?q=1#top"), "/repo/x?q=1#top");
  assert.equal(sameOriginPath("/a/./b/../c"), "/a/c");
  assert.equal(sameOriginPath("/." + BS + "/evil.com"), "/evil.com"); // backslash stripped, one slash left
});

test("sameOriginPath never yields a path a browser reads as another host", () => {
  for (const p of [
    "//evil.com",
    "/.//evil.com",
    "/x/..//evil.com",
    "/." + BS + "//evil.com",
    "/" + CR + "//evil.com",
    BS + BS + "evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    null,
  ]) {
    assert.equal(sameOriginPath(p), "/", JSON.stringify(p));
  }
});
