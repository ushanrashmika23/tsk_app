import fs from 'fs';
import path from 'path';

// Read .env file manually since this is a simple script
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  });
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const dbId = process.env.CLOUDFLARE_DATABASE_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;

if (!accountId || !dbId || !token) {
  console.error("Missing Cloudflare D1 credentials in .env");
  process.exit(1);
}

const schema = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT,
  priority TEXT DEFAULT 'medium',
  category TEXT,
  completed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
`;

async function initDb() {
  console.log("Initializing database...");
  
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sql: schema,
      params: [],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to initialize database: ${res.status} ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  if (!data.success) {
    console.error(`Query failed:`, data.errors);
    process.exit(1);
  }

  console.log("✅ Successfully created 'tasks' table in D1 database!");
}

initDb();
