# Atlas feature: announcements / marketing tracker

**Area:** Feature
**Kind:** code
**Status:** ready
**Priority:** P1
**Order:** 10
**Depends:**
**Repos:** atlas
**Links:**

A marketing/announcements surface in Atlas so it becomes the one-stop shop for "what should we announce, where, and is it posted yet." Mirror the Submissions feature (owner-only, local, reads todo markdown, copy-paste ready).

## What it tracks
Per announcement: what it is, the channels (blog, X, LinkedIn, changelog, a mailing list such as W3C CCG), status (idea / drafted / scheduled / posted), a copy-paste-ready draft per channel, the link once posted, and the date.

## Shape (proposed, reuses the Submissions build)
- New `/announcements` page, owner-only + local, like `/submissions`.
- Reads `<todoDir>/roadmap/announcements/*.md` with fields Title / Channels / Status / Date and a body with per-channel copy blocks. Reuse the Submissions `CopyBlock` + Download components.
- Channel chips + status pills so it reads at a glance; a "to post" filter and a per-channel copy button (paste straight into the blog CMS / X / LinkedIn).
- First content: the standards-push announcements (see opena2a-org `gtm-announce-standards-milestones`).

## Why
The user wants Atlas to track ALL work, including comms. Announcements currently live only in chat and roadmap prose; this makes them first-class and paste-ready, closing the loop from "shipped" to "announced."

## Log
- 2026-07-06 — Filed at the user's request. Build in a fresh session using `components/SubmissionsView.tsx` + `lib/submissions.ts` + `app/submissions/page.tsx` as the template.
