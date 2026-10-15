"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { useUserName } from "@/lib/userName";
import { getGreeting } from "@/lib/greetings";

/**
 * Only user and assistant prose is kept here.
 *
 * The previous version stored the server's raw message array, which included
 * assistant turns whose only purpose was to request tools (`content: null`)
 * while their matching `tool` results were filtered out. Re-sending that
 * history produced a malformed request, so this component now round-trips
 * exactly what the server returns and nothing else.
 */
type ChatMessage = { role: "user" | "assistant"; content: string };

/** Client-side cap; the server enforces its own limit as well. */
const HISTORY_LIMIT = 40;

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const { role, content } = value as { role?: unknown; content?: unknown };
  return (role === "user" || role === "assistant") && typeof content === "string" && content.trim() !== "";
}

export function AIClient() {
  const { name: userName } = useUserName();
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Text of the turn that failed, so it can be retried without retyping. */
  const [failedText, setFailedText] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dynamicGreeting = mounted ? getGreeting({ name: userName || null }) : "Good day";

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, error]);

  const runTurn = async (baseHistory: ChatMessage[], text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    const withUser = [...baseHistory, userMessage];

    setMessages(withUser);
    setInput("");
    setIsLoading(true);
    setError(null);
    setFailedText(null);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: withUser.slice(-HISTORY_LIMIT) }),
      });

      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        // The turn did not happen. Say so, and offer a retry rather than
        // rendering a fake assistant reply into the conversation.
        const message =
          (data as { error?: string } | null)?.error ?? `The assistant request failed (HTTP ${response.status}).`;
        setError(message);
        setFailedText(trimmed);
        return;
      }

      const incoming = (data as { messages?: unknown } | null)?.messages;
      const cleaned = Array.isArray(incoming) ? incoming.filter(isChatMessage) : null;
      if (!cleaned || cleaned.length === 0) {
        setError("The assistant returned an unreadable response.");
        setFailedText(trimmed);
        return;
      }

      setMessages(cleaned);
    } catch {
      setError("Could not reach the assistant. Check your connection and try again.");
      setFailedText(trimmed);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = (text: string) => {
    void runTurn(messages, text);
  };

  const retryLast = () => {
    if (!failedText) return;
    // The failed user message is already on screen; drop it from the base so
    // the retry does not send it twice.
    void runTurn(messages.slice(0, -1), failedText);
  };

  const quickActions = [
    "What do I have today?",
    "Give me a summary of my day.",
    "What's my next task?",
    "Add a task to study DSA tomorrow at 7 PM"
  ];

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mb-6">
              <Bot size={32} />
            </div>
            <h2 className="text-xl font-semibold mb-2">{dynamicGreeting}! How can I help?</h2>
            <p className="text-gray-500 dark:text-zinc-400 max-w-sm mb-8">
              Ask about your day, create new tasks naturally, or have me summarize your upcoming schedule.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(action)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-sm font-medium rounded-full transition-colors text-left"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user"
                ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                : "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                }`}>
                {msg.role === "user" ? <User size={16} /> : <Bot size={16} />}
              </div>
              <div className={`px-4 py-3 rounded-2xl max-w-[80%] whitespace-pre-wrap ${msg.role === "user"
                ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-tr-none"
                : "bg-gray-100 dark:bg-zinc-800 rounded-tl-none"
                }`}>
                {msg.content}
              </div>
            </div>
          ))
        )}

        {error && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-medium">That didn&apos;t go through.</p>
              <p className="mt-1 opacity-90">{error}</p>
            </div>
            {failedText && (
              <button
                onClick={retryLast}
                disabled={isLoading}
                className="flex items-center gap-1.5 text-sm font-medium underline underline-offset-2 disabled:opacity-50 shrink-0"
              >
                <RotateCcw size={14} />
                Retry
              </button>
            )}
          </div>
        )}

        {isLoading && (
          <div className="flex gap-4 flex-row">
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Bot size={16} />
            </div>
            <div className="px-4 py-3 rounded-2xl bg-gray-100 dark:bg-zinc-800 rounded-tl-none flex items-center gap-2 text-gray-500">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm font-medium">Checking your schedule...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Send size={20} />
          </button>
        </form>
      </div>
    </>
  );
}
