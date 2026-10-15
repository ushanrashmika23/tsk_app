/**
 * Shared error taxonomy.
 *
 * Every layer (database, tools, AI provider) raises a typed error so the agent
 * can distinguish "the query ran and there was nothing" from "the query never
 * reached the database". Conflating those two is what makes an assistant
 * invent an empty schedule.
 */

export type AppErrorCode =
  // --- configuration -------------------------------------------------
  | "DB_CONFIG_MISSING"
  | "AI_CONFIG_MISSING"
  // --- connectivity / credentials -------------------------------------
  | "DB_AUTH_FAILED"
  | "DB_NOT_FOUND"
  | "DB_TIMEOUT"
  | "DB_RATE_LIMITED"
  | "DB_UPSTREAM_ERROR"
  | "DB_RESPONSE_INVALID"
  // --- schema / query -------------------------------------------------
  | "DB_SCHEMA_MISSING"
  | "DB_SQL_ERROR"
  | "DB_CONSTRAINT_ERROR"
  // --- data -----------------------------------------------------------
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "AMBIGUOUS_MATCH"
  /** A required input is genuinely missing; the agent should ask the user. */
  | "NEEDS_CLARIFICATION"
  /** A destructive action needs an explicit confirmation first. */
  | "CONFIRMATION_REQUIRED"
  // --- ai provider ----------------------------------------------------
  | "RATE_LIMITED"
  | "AUTH_ERROR"
  | "TIMEOUT"
  | "MODEL_NOT_FOUND"
  | "TOOL_USE_FAILED"
  | "CONTEXT_LENGTH_EXCEEDED"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR"
  // --- agent ----------------------------------------------------------
  | "TOOL_NOT_ALLOWED"
  | "TOOL_ERROR"
  | "ITERATION_LIMIT"
  | "UNKNOWN";

export interface AppErrorOptions {
  details?: Record<string, unknown>;
  cause?: unknown;
  /**
   * Whether the message is safe to show a user. Internal causes (stack traces,
   * SQL fragments containing identifiers, provider payloads) stay `false`.
   */
  expose?: boolean;
}

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly expose: boolean;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  /** Plain object shape, safe to serialise into a tool result or a log line. */
  toJSON(): { code: AppErrorCode; message: string; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/** Raised by `lib/db/*`. Always means the data could not be read or written. */
export class DbError extends AppError {
  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(code, message, options);
  }
}

/** Raised by tool input validation before any database call happens. */
export class ToolValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, { details, expose: true });
  }
}

/**
 * A tool matched more than one plausible record. The agent must ask the user
 * to disambiguate instead of guessing.
 */
export class AmbiguousMatchError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("AMBIGUOUS_MATCH", message, { details, expose: true });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("NOT_FOUND", message, { details, expose: true });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Maps an arbitrary thrown value onto the taxonomy. Unknown values are
 * classified by inspecting common provider/driver error shapes, never by
 * string-matching user data.
 */
export function normalizeError(value: unknown): AppError {
  if (isAppError(value)) return value;

  if (value instanceof Error) {
    return new AppError("UNKNOWN", value.message, { cause: value });
  }

  if (value && typeof value === "object") {
    const candidate = value as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return new AppError(candidate.code as AppErrorCode, candidate.message, { cause: value });
    }
  }

  return new AppError("UNKNOWN", typeof value === "string" ? value : "Unknown error", { cause: value });
}
