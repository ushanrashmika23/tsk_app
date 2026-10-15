"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useUserName } from "@/lib/userName";
import { getGreeting } from "@/lib/greetings";
import { Sparkles, Check } from "lucide-react";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { name: savedName, setUserName } = useUserName();
  const [mounted, setMounted] = useState(false);
  const [localName, setLocalName] = useState("");
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setLocalName(savedName);
  }, [savedName]);

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    setUserName(localName);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="pt-4 pb-2">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      </header>

      <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-gray-100 dark:border-zinc-800/50 p-6 flex flex-col gap-6">
        <div>
          <h2 className="font-semibold text-lg mb-2">Theme</h2>
          <p className="text-sm text-gray-500 mb-4">Select your preferred appearance.</p>
          <div className="flex gap-3">
            {mounted && ['light', 'dark', 'system'].map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition-colors ${
                  theme === t
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
                    : "bg-gray-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-transparent hover:bg-gray-200 dark:hover:bg-zinc-600"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <hr className="border-gray-100 dark:border-zinc-700" />

        <div>
          <h2 className="font-semibold text-lg mb-2">Greeting & Profile</h2>
          <p className="text-sm text-gray-500 mb-4">Set your display name for personalized greetings.</p>
          
          <form onSubmit={handleSaveName} className="flex flex-col sm:flex-row gap-3 max-w-md">
            <input
              type="text"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              placeholder="e.g. Alex"
              maxLength={30}
              className="px-4 py-2 rounded-xl bg-gray-50 dark:bg-zinc-700/50 border border-gray-200 dark:border-zinc-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 flex-1 text-zinc-900 dark:text-zinc-100"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
            >
              {savedFeedback ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Saved</span>
                </>
              ) : (
                <span>Save Name</span>
              )}
            </button>
          </form>

          {mounted && (
            <div className="mt-3 p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2 max-w-md">
              <Sparkles className="w-4 h-4 shrink-0 text-blue-500" />
              <span>
                <strong>Preview:</strong> &quot;{getGreeting({ name: localName || null })}&quot;
              </span>
            </div>
          )}
        </div>

        <hr className="border-gray-100 dark:border-zinc-700" />

        <div>
          <h2 className="font-semibold text-lg mb-2">Default Priority</h2>
          <p className="text-sm text-gray-500 mb-4">Default priority for new tasks.</p>
          <div className="flex gap-3">
            <button className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-zinc-700 text-sm font-medium">Low</button>
            <button className="px-4 py-2 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-sm font-medium">Medium</button>
            <button className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-zinc-700 text-sm font-medium">High</button>
          </div>
        </div>
      </div>
    </div>
  );
}

