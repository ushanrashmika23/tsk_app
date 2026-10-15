import { NextResponse } from "next/server";
import { AIService, safeProviderMessage } from "@/lib/ai/AIService";
import { GroqProvider } from "@/lib/ai/providers/GroqProvider";
import { logAgentEvent } from "@/lib/ai/logger";
import { authFailureMessage, verifyRequestAuth } from "@/lib/auth";
import { AppError, normalizeError, type AppErrorCode } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous ceiling for a chat turn; anything larger is rejected unread. */
const MAX_BODY_BYTES = 256 * 1024;

function errorStatus(code: AppErrorCode): number {
  switch (code) {
    case "INVALID_REQUEST":
    case "VALIDATION_ERROR":
      return 400;
    case "RATE_LIMITED":
      return 429;
    case "TIMEOUT":
      return 504;
    case "AI_CONFIG_MISSING":
    case "AUTH_ERROR":
    case "MODEL_NOT_FOUND":
      return 503;
    default:
      return 502;
  }
}

function createProvider(): GroqProvider {
  const providerName = (process.env.AI_PROVIDER || "groq").trim().toLowerCase();
  if (providerName !== "groq") {
    // Both of these are marked `expose` deliberately: they name a provider and
    // an environment variable, never a value, and the operator who has to fix
    // the deployment is the one reading the error.
    throw new AppError("AI_CONFIG_MISSING", `The "${providerName}" AI provider is not supported by this build.`, {
      expose: true,
    });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new AppError("AI_CONFIG_MISSING", "GROQ_API_KEY is not configured on the server.", { expose: true });
  }
  return new GroqProvider(apiKey);
}

export async function POST(req: Request) {
  // The middleware matcher does not cover /api, so the boundary is enforced
  // here as well. Without this the endpoint is reachable unauthenticated.
  const auth = await verifyRequestAuth(req);
  if (!auth.authenticated) {
    logAgentEvent("unauthorized_request", { reason: auth.reason });
    return NextResponse.json({ error: authFailureMessage(auth.reason) }, { status: 401 });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body was not valid JSON." }, { status: 400 });
  }

  const messages = (body as { messages?: unknown } | null)?.messages;

  try {
    const service = new AIService({ provider: createProvider() });
    // Role, size and ordering validation all happen inside the service, so the
    // raw body is handed over as-is and the server system prompt stays
    // authoritative.
    const result = await service.chat(messages, { signal: req.signal });

    return NextResponse.json({
      messages: result.messages,
      correlationId: result.meta.correlationId,
      // Lets the UI distinguish "nothing found" from "some steps failed"
      // without exposing routing or model internals.
      degraded: result.meta.degraded,
    });
  } catch (error) {
    const appError = normalizeError(error);
    logAgentEvent("chat_request_failed", { code: appError.code });

    const message = appError.expose ? appError.message : safeProviderMessage(appError.code);
    return NextResponse.json({ error: message, code: appError.code }, { status: errorStatus(appError.code) });
  }
}
