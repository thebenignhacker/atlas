/**
 * Safe post-login redirect resolution. The callbackUrl is attacker-influenceable
 * (it rides in the login URL), so it must never send the owner off-origin.
 *
 * Two layers, because each alone is insufficient:
 *  - safeRedirectPath strips control chars (CR/LF/TAB) and backslash, which the
 *    WHATWG URL parser would otherwise drop/rewrite to sneak a CR-laced path like
 *    "/<CR>//evil.com" past a naive `//` check; then it requires a single leading
 *    slash.
 *  - sameOriginUrl resolves against the real origin and re-checks `.origin`, so
 *    even a payload that defeats the string filter can't escape same-origin.
 *
 * Bad chars are matched by CODE POINT (control range 0x00-0x1F, backslash 0x5C)
 * to avoid any fragile backslash-in-regex escaping.
 */

export function safeRedirectPath(p: unknown): string {
  if (typeof p !== "string") return "/";
  let s = "";
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c <= 0x1f || c === 0x5c) continue; // strip control chars + backslash
    s += p[i];
  }
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export function sameOriginUrl(path: unknown, origin: string): URL {
  const u = new URL(safeRedirectPath(path), origin);
  return u.origin === origin ? u : new URL("/", origin);
}
