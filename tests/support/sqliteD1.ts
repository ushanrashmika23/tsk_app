import { DatabaseSync, type StatementSync } from "node:sqlite";
import { classifyDatabaseError, type D1Database, type D1Meta, type D1PreparedStatement, type D1Result } from "@/lib/db/client";
import { AppError } from "@/lib/errors";

/**
 * A D1-compatible handle backed by a real SQLite engine.
 *
 * The production path goes through Cloudflare's HTTP API, which cannot be
 * exercised in a unit test. Rather than re-implement the queries (which would
 * test the fake instead of the app), this runs the app's actual SQL against
 * `node:sqlite`, so parameter binding, constraints, `meta.changes` and empty
 * result sets all behave the way they do in production.
 *
 * It also reproduces D1's two behaviours the query layer depends on:
 * unsupported bind types are rejected, and a failing statement fails loudly
 * instead of quietly returning no rows.
 */

const UNSUPPORTED_BIND = /boolean|object|undefined/i;

function toBindValue(value: unknown): null | number | bigint | string | Uint8Array {
  if (value === null) return null;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") return value;
  if (value instanceof Uint8Array) return value;
  // D1 rejects these outright; silently coercing them would hide a real bug.
  throw new Error(
    `D1_TYPE_ERROR: unsupported bind value (${UNSUPPORTED_BIND.test(typeof value) ? typeof value : "unknown"}). ` +
      "Only null, number, bigint, string and Uint8Array are supported."
  );
}

export interface FakeD1 extends D1Database {
  /** The underlying engine, for seeding and direct assertions. */
  readonly engine: DatabaseSync;
  /** SQL text of every statement prepared, to assert parameters are bound. */
  readonly executed: string[];
  /** Bind values seen per statement, for asserting parameterised queries. */
  readonly bound: unknown[][];
  /** Makes every following statement reject, as an unreachable database does. */
  failWith(error: Error | null): void;
  /** Throws the injected failure, if any. Called before each statement runs. */
  throwIfFailing(): void;
}

class FakeStatement implements D1PreparedStatement {
  constructor(
    private readonly owner: FakeD1,
    private readonly sql: string,
    private readonly params: readonly unknown[] = []
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new FakeStatement(this.owner, this.sql, values);
  }

  private guard(): void {
    this.owner.executed.push(this.sql);
    this.owner.bound.push([...this.params]);
    this.owner.throwIfFailing();
  }

  private args() {
    return this.params.map(toBindValue);
  }

  /**
   * Prepares and runs one statement, translating a raw SQLite failure into the
   * same typed error Cloudflare's HTTP API produces — a missing table must be
   * `DB_SCHEMA_MISSING` here too, since SQLite resolves table names while
   * preparing, not while stepping. An injected failure passes through untouched
   * so a test can simulate one specific database condition.
   */
  private execute<T>(run: (statement: StatementSync) => T): T {
    this.guard();
    try {
      return run(this.owner.engine.prepare(this.sql));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw classifyDatabaseError(error instanceof Error ? error.message : String(error));
    }
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const rows = this.execute((statement) => statement.all(...this.args()) as T[]);
    const meta: D1Meta = { changes: 0, rows_read: rows.length, duration: 0 };
    return { results: rows, success: true, meta };
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const result = this.execute((statement) => statement.run(...this.args()));
    const meta: D1Meta = {
      changes: Number(result.changes ?? 0),
      last_row_id: Number(result.lastInsertRowid ?? 0),
      duration: 0,
    };
    return { results: [] as T[], success: true, meta };
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.execute((statement) => statement.get(...this.args()) as T | undefined);
    return row === undefined ? null : row;
  }
}

class SqliteD1Database implements FakeD1 {
  readonly executed: string[] = [];
  readonly bound: unknown[][] = [];
  private failure: Error | null = null;

  constructor(readonly engine: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(this, query);
  }

  failWith(error: Error | null): void {
    this.failure = error;
  }

  throwIfFailing(): void {
    if (this.failure) throw this.failure;
  }
}

/** Creates an empty in-memory database handle. */
export function createSqliteD1(): FakeD1 {
  return new SqliteD1Database(new DatabaseSync(":memory:"));
}
