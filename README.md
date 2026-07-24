# Shani Bug Tracker

An enterprise bug tracking, QA and release management platform — fast, minimal, real-time and mobile-first.

Built to cover what Jira / Linear / GitHub Issues / Azure Boards do, while staying simple enough for non-technical reporters.

---

## Stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Framework  | Next.js 16 (App Router, React 19, Server Components + Actions) |
| Language   | TypeScript (strict)                                            |
| Styling    | Tailwind CSS v4 with a token-based design system               |
| Database   | Prisma 7 ORM + SQLite (dev) — swap the adapter for Postgres    |
| Real-time  | Server-Sent Events (`/api/stream`) + an in-process event bus   |
| Icons      | lucide-react                                                   |
| Validation | zod                                                            |

## Getting started

```bash
npm install
npx prisma migrate dev      # create the SQLite database
npm run db:seed             # load a realistic demo workspace
npm run dev                 # http://localhost:3000
```

### Scripts

| Script               | Purpose                                    |
| -------------------- | ------------------------------------------ |
| `npm run dev`        | Start the dev server                       |
| `npm run build`      | Production build                           |
| `npm run db:seed`    | Wipe + reseed demo data                    |
| `npm run db:reset`   | Drop, re-migrate and reseed the database   |
| `npm run db:studio`  | Open Prisma Studio to inspect the data     |

## Architecture

```
src/
  app/                    routes (App Router)
    page.tsx              Dashboard
    bugs|features|improvements|tasks/   issue modules (one shared engine)
    issue/[id]/           issue detail
    qa|releases|roadmap|sprints|analytics|notifications|settings/
    api/stream/           SSE real-time channel
    api/search/           instant global search
  components/
    ui/                   design-system primitives (Button, Card, Modal, …)
    shell/                sidebar, topbar, command palette, app shell
    issues/               list, kanban board, detail, report form
    dashboard/            charts (pure SVG, no chart library)
    modules/              QA, settings, notifications views
  lib/
    prisma.ts             Prisma client + driver adapter
    constants.ts          issue types, priorities, severities, statuses
    queries.ts            issue read-side data access + DTO serialization
    module-queries.ts     read-side data for the secondary modules
    actions.ts            server actions (all writes)
    realtime.ts           pub/sub event bus feeding SSE
prisma/
  schema.prisma           normalized multi-tenant schema
  seed.ts                 demo data generator
```

### Key design decisions

- **One issue engine, four modules.** Bugs, Feature Requests, Improvements and Tasks are all `Issue` rows distinguished by `type`. Each type belongs to a `group`, and each module simply filters by group — so every feature (kanban, filters, detail, comments, real-time) works everywhere for free.
- **Status categories drive the board.** Projects own unlimited custom `WorkflowStatus` rows; each maps to a category (`backlog → unstarted → started → testing → done/canceled`). The kanban groups by category, so a single board works across projects that have different workflows. Dropping a card resolves the correct target status within that issue's own project.
- **No enums.** SQLite has no native enum support, so status/priority/severity are `String` columns backed by a single source of truth in `src/lib/constants.ts`.
- **Writes go through server actions**, which log an immutable `Activity` record, emit a real-time event, and revalidate affected routes.
- **Theming via CSS custom properties** on `<html>` (`data-theme`, `data-density`, `data-contrast`), applied by a blocking script before first paint to avoid a flash. Tailwind utilities map to those tokens, so light / dark / compact / high-contrast all work without duplicated classes.

## Features implemented

- Dashboard with live metrics, 30-day created-vs-resolved trend, breakdowns and personal queues
- Bug / Feature / Improvement / Task modules with list **and** drag-and-drop kanban views
- Rich report form: 23 issue types, priority / severity / impact, expected vs actual, repro steps, drag-drop & paste attachments, and one-click environment auto-detection
- Issue detail: inline editing, status/priority/severity/impact, assignees, labels, threaded comments (with internal notes), attachments, time logging, watchers and a full activity trail
- QA module: test plans, cases and pass / fail / blocked / retest execution
- Releases, roadmap timeline, sprint planning, analytics, notifications and an admin/settings area
- Global command palette (⌘K), instant search, `c` to report, bulk edit & mass update
- Real-time sync across every screen over SSE — no refresh
- Light, dark, compact and high-contrast modes; responsive from phone to desktop

## Roadmap

- Authentication & RBAC (the session layer is stubbed in `src/lib/session.ts`)
- Native Android (Kotlin / Material 3) and iOS (SwiftUI) apps with offline sync
- AI features: duplicate detection, root-cause suggestions, auto-triage, generated release notes
- Third-party integrations (GitHub, GitLab, Slack, Sentry, Stripe…)
- Public REST + GraphQL API with API keys and rate limiting

## License

Private.
