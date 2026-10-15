/**
 * Minimal ambient types for Node's built-in `node:sqlite` module.
 *
 * The installed `@types/node` (20.x) predates the module, and the test suite
 * uses it to run the real query layer against a genuine SQLite engine. Only the
 * surface the tests touch is declared; nothing in application code imports it.
 */
declare module "node:sqlite" {
  export type SQLInputValue = null | number | bigint | string | Uint8Array;

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export interface StatementSync {
    all(...anonymousParameters: SQLInputValue[]): unknown[];
    get(...anonymousParameters: SQLInputValue[]): unknown;
    run(...anonymousParameters: SQLInputValue[]): StatementResultingChanges;
  }

  export class DatabaseSync {
    constructor(location?: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
