"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2 } from "lucide-react";

type Message = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  name?: string;
};

export function AIClient() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: text };
    const currentMessages = [...messages, userMessage];

    setMessages(currentMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: currentMessages }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch response");
      }

      setMessages(data.messages.filter((m: any) => m.role !== "system" && m.role !== "tool"));
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: error.message || "I encountered an error connecting to my brain." },
      ]);
    } finally {
      setIsLoading(false);
    }
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
            <h2 className="text-xl font-semibold mb-2">How can I help with your schedule?</h2>
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
          messages.filter(m => m.role === "user" || m.role === "assistant").map((msg, i) => (
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

        {isLoading && (
          <div className="flex gap-4 flex-row">
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Bot size={16} />
            </div>
            <div className="px-4 py-3 rounded-2xl bg-gray-100 dark:bg-zinc-800 rounded-tl-none flex items-center gap-2 text-gray-500">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm font-medium">Thinking...</span>
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
