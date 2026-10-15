import { AppError } from "@/lib/errors";

/**
 * Retry policy for provider failures.
 *
 * Lives here rather than in a provider module because the decision is made by
 * the agent loop, which is provider-agnostic: it classifies *application* error
 * codes, not SDK error classes. Keeping it in `providers/GroqProvider` made the
 * loop depend on one concrete provider — and meant that replacing that module
 * (in a test, or with a second provider) silently changed the retry behaviour.
 *
 * Only failures where resending the identical request is both safe and useful
 * are listed. A mutation that may or may not have been applied is never retried
 * here; the caller has to decide that, because replaying it could apply it twice.
 */
export function isRetryableProviderError(error: unknown): boolean {
  const code = error instanceof AppError ? error.code : undefined;
  return code === "RATE_LIMITED" || code === "PROVIDER_ERROR" || code === "TIMEOUT";
}
