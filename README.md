# Task & Schedule Management

A clean, mobile-responsive Task & Schedule Management Web App built with Next.js and Cloudflare D1.

## Getting Started

### 1. Prerequisites

- Node.js (v18+)
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

### 3. Apply Migrations

Apply the initial schema to your local and remote databases:

**Local Development:**
```bash
npx wrangler d1 execute tasks-db --local --file=./migrations/0001_initial.sql
```

**Production:**
```bash
npx wrangler d1 execute tasks-db --remote --file=./migrations/0001_initial.sql
```

### 4. Run Locally

To run the application locally with access to the local D1 database, we use the Cloudflare Pages dev server:

```bash
npm run build
npx wrangler pages dev .vercel/output/static
```

### 4. Run Locally

Create a `.env.local` file in your project root with your Cloudflare D1 credentials:

```env
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_DATABASE_ID=your-database-id
CLOUDFLARE_API_TOKEN=your-api-token
```

You can get an API Token from your Cloudflare Dashboard (My Profile > API Tokens). Make sure it has "D1: Edit" permissions.

Then, just run the standard Next.js dev server:

```bash
npm run dev
```

### 5. Deploy to Vercel

This app is configured to connect to Cloudflare D1 remotely via HTTP, which makes it natively compatible with Vercel!

1. Push your code to a GitHub repository.
2. Go to Vercel and import the repository.
3. In the Environment Variables section, add:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_DATABASE_ID`
   - `CLOUDFLARE_API_TOKEN`
4. Click Deploy.

## Features

- **Dashboard:** See today's tasks and progress at a glance.
- **Task Management:** Create, edit, and organize tasks.
- **Schedule:** Day and week views to manage upcoming tasks.
- **Responsive:** Mobile-first design with bottom navigation.
- **Minimal UI:** Clean, whitespace-heavy design for reduced mental load.
