import { AIClient } from "./AIClient";

export const metadata = {
  title: "AI Assistant | Task & Schedule",
};

export default function AIPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">AI Assistant</h1>
        <p className="text-gray-500 dark:text-zinc-400">Manage your schedule with natural language.</p>
      </div>
      <div className="flex-1 bg-white dark:bg-zinc-800 rounded-2xl shadow-sm border border-gray-200 dark:border-zinc-700 overflow-hidden flex flex-col relative">
        <AIClient />
      </div>
    </div>
  );
}
