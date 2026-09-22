/**
 * Account headroom join for the token page.
 *
 * The roadmap asks for window pressure joined with the accounts' headroom
 * readings (`headroom.json`, per-account five-hour and weekly utilisation).
 * No such file exists on this machine and Atlas has no reader for it yet, so
 * the page says so instead of rendering zeros as if they were readings. When a
 * source appears, the rollup's `headroom` field is where it joins in.
 */
export const HEADROOM_NOTE =
  "account headroom readings are not joined yet: no headroom source is configured on this machine";
