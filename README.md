# Task & Schedule Management

A clean, mobile-responsive Task & Schedule Management Web App built with Next.js and Cloudflare D1, with an AI assistant that reads and changes your real tasks, projects and goals.

## Getting Started

### 1. Prerequisites

- Node.js (v20+; the test suite uses the built-in `node:sqlite` module, which needs v22.5+)
- npm or pnpm
- A Cloudflare account

### 2. Create the D1 Database

First, you need to create a D1 database on Cloudflare. You can do this via the Wrangler CLI:

```bash
npx wrangler d1 create tasks-db
```

This will output a `database_id`. Update your `wrangler.toml` file with this ID:

```toml
[[d1_databases]]
binding = "DB"
database_name = "tasks-db"
database_id = "your-database-id-here"
migrations_dir = "migrations"
```

### 3. Environment Variables

Create a `.env` file in the project root. Nothing here is committed.

```env
# --- database (required) -------------------------------------------------
# CLOUDFLARE_DATABASE_ID must be the same database_id as in wrangler.toml.
# Pointing it at a different database is the single most common cause of an
# assistant that insists your schedule is empty.
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_DATABASE_ID=your-database-id
CLOUDFLARE_API_TOKEN=your-api-token        # D1: Edit permission

# --- application auth (required) ----------------------------------------
# Without this the app is considered unconfigured and /api/ai/chat answers 401.
APP_PASSWORD=a-strong-password

# --- AI provider (required for the assistant) ---------------------------
GROQ_API_KEY=your-groq-key
# AI_PROVIDER=groq                          # only "groq" is supported

# Optional model overrides. Identifiers must exist in the capability table in
# lib/ai/config.ts; an unknown identifier for a role that needs tools falls back
# to a verified tool-calling model and records a warning.
# GROQ_SIMPLE_MODEL=qwen/qwen3.8-27b
# GROQ_TOOL_MODEL=qwen/qwen3.8-27b
# GROQ_SUMMARY_MODEL=qwen/qwen3.8-27b
# GROQ_REASONING_MODEL=openai/gpt-oss-120b

# Optional: IANA timezone for every date the app and the assistant compute.
# APP_TIMEZONE=Asia/Colombo

# Optional agent limits (defaults shown). The time budgets are sized from
# measured provider latency, not from a preference: a single tool-calling
# completion on a busy day has been observed to take 10-27 s, and on Groq's
# free tier (7000 input tokens/minute for qwen3.8-27b) a four-step request can
# spend the whole budget waiting to be allowed to send. Raise these if your
# function host allows longer requests — Vercel's default function duration is
# lower than AI_TOTAL_BUDGET_MS, so set it there too.
# AI_MAX_TOOL_ITERATIONS=6
# AI_TOTAL_BUDGET_MS=90000
# AI_REQUEST_TIMEOUT_MS=45000
# AI_MAX_READ_RETRIES=1
# AI_BASE_RETRY_DELAY_MS=400
# AI_MAX_HISTORY_MESSAGES=24
# AI_MAX_INCOMING_MESSAGES=60
# AI_MAX_MESSAGE_LENGTH=4000
```

### 4. Apply Migrations

**If you are starting from an empty database**, let Wrangler track them:

```bash
npm run db:migrate                                  # remote
npx wrangler d1 migrations apply tsk-ur23 --local   # local
```

**If your database already has tables** (it was created with `d1 execute --file=…`),
`d1_migrations` may be missing entries, and `migrations apply` will try to re-run
files that have already taken effect. `0001` uses `IF NOT EXISTS` and is safe;
`0002` and `0003` are not re-runnable (`CREATE TABLE goals`,
`ALTER TABLE tasks ADD COLUMN project_id`). Check what is recorded:

```bash
npx wrangler d1 execute tsk-ur23 --remote \
  --command "SELECT name FROM d1_migrations ORDER BY id"
```

If a migration's tables already exist but it is not listed, record it instead of
re-running it (this only writes to the ledger, it does not touch your data):

```bash
npx wrangler d1 execute tsk-ur23 --remote \
  --command "INSERT INTO d1_migrations (name) VALUES ('0002_add_goals.sql')"
```

Every migration after `0004` is written to be idempotent and additive, so it is
safe on a populated database.

### 5. Run Locally

```bash
npm run dev
```

### 6. Tests, Type Check and Build

```bash
npm test          # vitest, no API key and no network required
npm run typecheck # tsc --noEmit
npm run build     # next build --webpack
```

> `npm run lint` does not work: Next 16 removed `next lint`, and this repository
> has no ESLint configuration. This predates the AI work; `typecheck` and
> `build` are the gates that do pass.

### 7. Deploy to Vercel

This app is configured to connect to Cloudflare D1 remotely via HTTP, which makes it natively compatible with Vercel.

1. Push your code to a GitHub repository.
2. Go to Vercel and import the repository.
3. In the Environment Variables section, add every variable from step 3 —
   including `APP_PASSWORD` (without it the AI endpoint returns 401) and
   `GROQ_API_KEY` (without it it returns 503).
4. Click Deploy.

#### Deploying with Cloudflare Pages instead

`wrangler.toml` also describes a Pages deployment. In that case the D1 binding
in `wrangler.toml` is used directly rather than the REST credentials, so
`CLOUDFLARE_*` are not needed, but `APP_PASSWORD`, `GROQ_API_KEY` and
`APP_TIMEZONE` still are.

## The AI Assistant

`POST /api/ai/chat` takes `{ messages: [{ role: "user" | "assistant", content }] }`
and returns `{ messages, correlationId, degraded }`. Only `user` and `assistant`
turns are accepted — the system prompt is built on the server and cannot be
replaced by the client — and the endpoint requires the same auth cookie as the
rest of the app.

The model never touches the database directly. It calls tools from a single
registry (`lib/ai/tools/`), where each tool has one definition: a name, a
description, a JSON Schema derived from its Zod validator (so the schema the
model sees and the validation it gets cannot drift), a handler, and a
`read`/`write` kind. Arguments are validated before any database call; a failure
comes back as `{ ok: false, error: { code, message } }` and is never presented to
the model as an empty result. Writes require an exact record match and
destructive ones require explicit confirmation.

| Group | Tools |
| --- | --- |
| Tasks (read) | `get_tasks`, `get_task`, `find_task`, `get_today_tasks`, `get_next_task`, `get_schedule`, `get_task_summary` |
| Tasks (write) | `create_task`, `update_task`, `complete_task`, `reopen_task`, `delete_task` |
| Projects | `get_projects`, `get_project`, `find_project`, `create_project`, `update_project`, `delete_project`, `get_project_tasks` |
| Goals | `get_goals`, `get_goal`, `find_goal`, `create_goal`, `update_goal`, `complete_goal`, `reopen_goal`, `delete_goal`, `get_goal_progress` |
| Diagnostics | `get_system_status` |

Date handling notes:

- Every date the assistant computes comes from `lib/dates.ts` using
  `APP_TIMEZONE` (default `Asia/Colombo`). Dates are stored as civil dates
  (`YYYY-MM-DD`) and times as 24-hour local times (`HH:MM`), so no timezone
  arithmetic ever happens in the model.
- A relative phrase the tool layer cannot resolve safely ("later this week")
  produces a clarification request (`NEEDS_CLARIFICATION`) rather than a guess.
- "Today's schedule" is always the internal D1 schedule. There is no external
  calendar integration: if you ask about Google Calendar or Outlook, the
  assistant says so and answers from the internal schedule instead.

### When the model misbehaves

The prompt is not treated as the only enforcement. Three failure modes seen in
production are handled in the agent loop instead:

- **A confirmed operation answered with prose.** Asked "Delete it?" → "Yes,
  delete it", the model has been observed returning `finish_reason: "stop"` with
  the text "Deleted — …" and no tool call at all, leaving the row in place. The
  loop detects the agreement from the conversation, re-asks once with
  `tool_choice: "required"`, and if the model still does not act, appends
  "(No change was made…)" to the reply and marks the request degraded. A
  mutation is therefore never reported as done on the strength of the model's
  own prose.
- **A bare agreement.** "yes" carries no verbs, so routing it on its own left
  the run with read-only tools and the confirmed move could not run. An
  agreement is now routed as the request it agrees with.
- **A rate limit that names a wait.** The provider's `retry-after` (or the wait
  in its message, clamped to 15 s) is honoured before the single allowed
  transient retry instead of the 400 ms first backoff.

Every write tool is still resolved and validated independently of any of this:
an id the model invents produces `NOT_FOUND`, never a change to another record.

## Features

- **Dashboard:** See today's tasks and progress at a glance.
- **Task Management:** Create, edit, and organize tasks.
- **Schedule:** Day and week views to manage upcoming tasks.
- **AI Assistant:** Ask about your day, plan around goals and projects, and
  create or move tasks in natural language.
- **Responsive:** Mobile-first design with bottom navigation.
- **Minimal UI:** Clean, whitespace-heavy design for reduced mental load.

