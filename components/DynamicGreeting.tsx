"use client";

import { useEffect, useState, useMemo } from "react";
import { Sunrise, Sun, Sunset, Moon, Edit2, Check, X, Sparkles } from "lucide-react";
import {
  getTimeOfDay,
  getGreetingPhrase,
  formatGreeting,
  getGreetingSubtext,
  formatGreetingDate,
  getTimeOfDayTheme,
  type TimeOfDay,
} from "@/lib/greetings";
import { useUserName } from "@/lib/userName";

interface DynamicGreetingProps {
  remaining: number;
  completed: number;
  serverHour?: number;
  serverDateStr?: string;
}

export function DynamicGreeting({
  remaining,
  completed,
  serverHour,
  serverDateStr,
}: DynamicGreetingProps) {
  const { name, setUserName, isLoaded } = useUserName();
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCurrentDate(new Date());

    // Update time every 30 seconds to react to hour boundaries smoothly
    const interval = setInterval(() => {
      setCurrentDate(new Date());
    }, 30_000);

    return () => clearInterval(interval);
  }, []);

  const activeHour = mounted ? currentDate.getHours() : (serverHour ?? new Date().getHours());
  const timeOfDay: TimeOfDay = getTimeOfDay(activeHour);
  const theme = getTimeOfDayTheme(timeOfDay);

  const baseGreeting = getGreetingPhrase(timeOfDay);
  const displayName = isLoaded && name ? name : null;
  const fullGreeting = formatGreeting(baseGreeting, displayName);

  const subtext = useMemo(() => {
    return getGreetingSubtext({
      remaining,
      completed,
      timeOfDay,
      hour: activeHour,
    });
  }, [remaining, completed, timeOfDay, activeHour]);

  const displayDate = mounted
    ? formatGreetingDate(currentDate)
    : serverDateStr || formatGreetingDate(new Date());

  const handleStartEditing = () => {
    setNameInput(displayName || "");
    setIsEditingName(true);
  };

  const handleSaveName = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setUserName(nameInput);
    setIsEditingName(false);
  };

  const handleCancelEditing = () => {
    setIsEditingName(false);
    setNameInput("");
  };

  const IconComponent =
    timeOfDay === "morning"
      ? Sunrise
      : timeOfDay === "afternoon"
      ? Sun
      : timeOfDay === "evening"
      ? Sunset
      : Moon;

  return (
    <header className="pt-4 pb-2">
      <div className="flex flex-col gap-2">
        {/* Ambient Time-of-Day Badge */}
        <div className="flex items-center gap-2">
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide border shadow-sm transition-all duration-300 ${theme.badgeBg} ${theme.badgeBorder} ${theme.badgeText}`}
          >
            <IconComponent className={`w-3.5 h-3.5 ${theme.accentColor}`} />
            <span className="capitalize">{timeOfDay}</span>
          </div>

          <span className="text-xs text-gray-400 dark:text-zinc-500">•</span>

          <span className="text-xs font-medium text-gray-500 dark:text-zinc-400">
            {displayDate}
          </span>
        </div>

        {/* Dynamic Greeting Title */}
        <div className="flex items-center gap-3 flex-wrap">
          {isEditingName ? (
            <form onSubmit={handleSaveName} className="flex items-center gap-2">
              <span className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
                {baseGreeting},
              </span>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your name"
                autoFocus
                maxLength={30}
                className="px-3 py-1 text-xl sm:text-2xl font-bold rounded-xl border border-blue-400 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
              <button
                type="submit"
                title="Save name"
                className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Check className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={handleCancelEditing}
                title="Cancel"
                className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </form>
          ) : (
            <div className="group inline-flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 transition-colors">
                {fullGreeting}
              </h1>

              {mounted && (
                <button
                  onClick={handleStartEditing}
                  title={displayName ? "Change your name" : "Set your name"}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all text-xs flex items-center gap-1"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span className="sr-only">Edit name</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Motivational / Contextual Subtitle */}
        <p className="text-sm sm:text-base text-gray-600 dark:text-zinc-400 flex items-center gap-1.5 font-normal">
          <Sparkles className="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0" />
          <span>{subtext}</span>
        </p>
      </div>
    </header>
  );
}

