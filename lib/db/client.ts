import { DbError } from "@/lib/errors";

/**
 * Cloudflare D1 client over the REST API.
 *
 * Design rules (these exist because their violation produced fabricated data):
 *
 *  1. A failed query NEVER returns an empty result set. It throws a `DbError`.
 *  2. A query that genuinely returns zero rows returns `results: []` with
 *     `success: true`. Callers can therefore trust `[]` to mean "none".
 *  3. A missing configuration is a hard error, not a silent empty list.
 *  4. Every network call is bounded by a timeout.
 */

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1Meta {
  duration?: number;
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  served_by?: string;
  [key: string]: unknown;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
}

export interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Reads D1 configuration, throwing a typed error when anything is missing. */
export function readD1Config(env: NodeJS.ProcessEnv = process.env): D1Config {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = env.CLOUDFLARE_DATABASE_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();

  const missing = [
    !accountId && "CLOUDFLARE_ACCOUNT_ID",
    !databaseId && "CLOUDFLARE_DATABASE_ID",
    !apiToken && "CLOUDFLARE_API_TOKEN",
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    throw new DbError(
      "DB_CONFIG_MISSING",
      `Cloudflare D1 is not configured. Missing environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
      { details: { missing } }
    );
  }

  const timeoutMs = Number(env.D1_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  return {
    accountId: accountId!,
    databaseId: databaseId!,
    apiToken: apiToken!,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

interface D1ApiError {
  code?: number;
  message?: string;
}

interface D1ApiResponse {
  success?: boolean;
  errors?: D1ApiError[];
  messages?: unknown[];
  result?: Array<{
    success?: boolean;
    results?: unknown[];
    meta?: D1Meta;
    error?: string;
  }>;
}

/** Cloudflare error codes that indicate a schema problem rather than bad input. */
const SQLITE_NO_SUCH_TABLE = 7500;

/**
 * Maps a database engine message onto the shared taxonomy.
 *
 * Exported because the test harness runs the same SQL through a real SQLite
 * engine instead of Cloudflare's HTTP API: classifying both through one
 * function is what keeps "table missing" meaning the same thing in a test and
 * in production.
 */
export function classifyDatabaseError(message: string, code?: number): DbError {
  if (code === SQLITE_NO_SUCH_TABLE || /no such table|no such column/i.test(message)) {
    return new DbError("DB_SCHEMA_MISSING", `The database schema is incomplete: ${message}`, {
      details: { databaseCode: code },
    });
  }
  if (/UNIQUE constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed/i.test(message)) {
    return new DbError("DB_CONSTRAINT_ERROR", message, { details: { databaseCode: code }, expose: true });
  }
  if (/syntax error|no such/i.test(message)) {
    return new DbError("DB_SQL_ERROR", message, { details: { databaseCode: code } });
  }
  return new DbError("DB_UPSTREAM_ERROR", `D1 query failed: ${message}`, { details: { databaseCode: code } });
}

function classifyApiErrors(errors: D1ApiError[] | undefined): DbError {
  const first = errors?.[0];
  return classifyDatabaseError(first?.message ?? "Unknown Cloudflare error", first?.code);
}

function classifyHttpStatus(status: number, body: string): DbError {
  const snippet = body.slice(0, 300);
  if (status === 401 || status === 403) {
    return new DbError("DB_AUTH_FAILED", "Cloudflare rejected the D1 API token (check its permissions).", {
      details: { status },
    });
  }
  if (status === 404) {
    return new DbError(
      "DB_NOT_FOUND",
      "The configured CLOUDFLARE_DATABASE_ID does not exist for this account.",
      { details: { status } }
    );
  }
  if (status === 429) {
    return new DbError("DB_RATE_LIMITED", "Cloudflare rate limited the D1 request.", { details: { status } });
  }
  return new DbError("DB_UPSTREAM_ERROR", `D1 API returned HTTP ${status}.`, {
    details: { status, body: snippet },
  });
}

export class RemoteD1PreparedStatement implements D1PreparedStatement {
  constructor(
    private readonly query: string,
    private readonly params: unknown[],
    private readonly config: D1Config
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new RemoteD1PreparedStatement(this.query, values, this.config);
  }

  private async execute<T>(): Promise<D1Result<T>> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/d1/database/${this.config.databaseId}/query`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql: this.query, params: this.params }),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DbError("DB_TIMEOUT", `The database did not respond within ${this.config.timeoutMs}ms.`, {
          cause: error,
        });
      }
      throw new DbError("DB_UPSTREAM_ERROR", "Could not reach the Cloudflare D1 API.", { cause: error });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw classifyHttpStatus(response.status, body);
    }

    let payload: D1ApiResponse;
    try {
      payload = (await response.json()) as D1ApiResponse;
    } catch (error) {
      throw new DbError("DB_RESPONSE_INVALID", "The D1 API returned a body that is not valid JSON.", {
        cause: error,
      });
    }

    if (payload.success === false) {
      throw classifyApiErrors(payload.errors);
    }
    if (!Array.isArray(payload.result) || payload.result.length === 0) {
      throw new DbError("DB_RESPONSE_INVALID", "The D1 API response did not include a query result.", {
        details: { errors: payload.errors },
      });
    }

    const first = payload.result[0];
    if (first?.success === false) {
      throw new DbError("DB_SQL_ERROR", first.error || "The database reported an unsuccessful query.", {
        details: { meta: first.meta },
      });
    }

    const results = first?.results;
    if (results !== undefined && !Array.isArray(results)) {
      throw new DbError("DB_RESPONSE_INVALID", "The D1 result rows were not an array.");
    }

    return {
      // `run()` on D1 returns `meta` only; that legitimately means "zero rows
      // returned", not "no rows matched".
      results: (results ?? []) as T[],
      success: true,
      meta: first?.meta ?? {},
    };
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async first<T = unknown>(): Promise<T | null> {
    const res = await this.execute<T>();
    return res.results.length > 0 ? res.results[0] : null;
  }
}

export class RemoteD1Database implements D1Database {
  constructor(private readonly config: D1Config) {}

  prepare(query: string): D1PreparedStatement {
    return new RemoteD1PreparedStatement(query, [], this.config);
  }
}

let dbInstance: D1Database | null = null;
let dbInstanceKey: string | null = null;
/** Handle supplied through `setDb`, which takes precedence over configuration. */
let injectedDb: D1Database | null = null;

/**
 * Returns the shared D1 database handle.
 *
 * Configuration is read on every call so a missing credential surfaces as a
 * typed error at the point of use.
 *
 * The injected handle is checked *before* configuration: tests run without
 * Cloudflare credentials, and reading the config first would throw before the
 * seam could be reached.
 */
export function getDb(env: NodeJS.ProcessEnv = process.env): D1Database {
  if (injectedDb) return injectedDb;

  const config = readD1Config(env);
  const key = `${config.accountId}:${config.databaseId}`;
  if (!dbInstance || dbInstanceKey !== key) {
    dbInstance = new RemoteD1Database(config);
    dbInstanceKey = key;
  }
  return dbInstance;
}

/** Test seam: replaces the shared handle (pass `null` to reset). */
export function setDb(instance: D1Database | null): void {
  injectedDb = instance;
  if (instance) {
    dbInstance = null;
    dbInstanceKey = null;
  }
}

export type ScheduleHealthState =
  | "ok"
  | "empty"
  | "schema_missing"
  | "config_missing"
  | "auth_failed"
  | "not_found"
  | "unreachable"
  | "error";

export interface ScheduleHealth {
  state: ScheduleHealthState;
  /** True only when the internal schedule was read successfully. */
  reachable: boolean;
  taskCount?: number;
  todayCount?: number;
  message: string;
  code?: string;
}

/**
 * Reads the internal schedule to prove whether the database is genuinely
 * reachable. This distinguishes "you have nothing scheduled" from "the
 * schedule could not be loaded", which the assistant must not conflate.
 */
export async function checkScheduleHealth(todayIso: string): Promise<ScheduleHealth> {
  try {
    const total = await getDb().prepare("SELECT COUNT(*) AS count FROM tasks").first<{ count: number }>();
    if (!total) {
      return {
        state: "schema_missing",
        reachable: false,
        message: "The tasks table could not be read.",
        code: "DB_SCHEMA_MISSING",
      };
    }
    const today = await getDb()
      .prepare("SELECT COUNT(*) AS count FROM tasks WHERE scheduled_date = ?")
      .bind(todayIso)
      .first<{ count: number }>();

    const taskCount = Number(total.count ?? 0);
    const todayCount = Number(today?.count ?? 0);

    return {
      state: taskCount === 0 ? "empty" : "ok",
      reachable: true,
      taskCount,
      todayCount,
      message:
        taskCount === 0
          ? "The internal schedule was read successfully and contains no tasks."
          : `The internal schedule was read successfully (${taskCount} tasks, ${todayCount} today).`,
    };
  } catch (error) {
    if (error instanceof DbError) {
      const map: Partial<Record<string, ScheduleHealthState>> = {
        DB_CONFIG_MISSING: "config_missing",
        DB_AUTH_FAILED: "auth_failed",
        DB_NOT_FOUND: "not_found",
        DB_SCHEMA_MISSING: "schema_missing",
        DB_TIMEOUT: "unreachable",
        DB_UPSTREAM_ERROR: "unreachable",
        DB_RATE_LIMITED: "unreachable",
      };
      return {
        state: map[error.code] ?? "error",
        reachable: false,
        message: error.message,
        code: error.code,
      };
    }
    return {
      state: "error",
      reachable: false,
      message: error instanceof Error ? error.message : "Unknown database failure.",
    };
  }
}
