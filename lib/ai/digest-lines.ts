import type { ActivityEvent } from "@/lib/types";
import { utcDate } from "@/lib/util/date";

/**
 * One RECENT COMMITS line of the digest's portfolio text: the event's day, then
 * its title. The day is the UTC day of the event's instant (utcDate), the day
 * the activity view files it under. Commit times carry the committer's UTC
 * offset (git log --format=%cI), so the first ten characters of a time can
 * name another day. A time that does not parse is written without a day.
 */
export function recentEventLine(e: Pick<ActivityEvent, "title"> & { ts: string | null }): string {
  const day = utcDate(e.ts);
  return day === null ? `- ${e.title}` : `- ${day} ${e.title}`;
}
