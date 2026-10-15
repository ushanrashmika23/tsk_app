/**
 * Dynamic greeting system for Task & Schedule App.
 *
 * Provides:
 *  - Time-of-day classification (morning, afternoon, evening, night)
 *  - Dynamic greeting text ("Good morning", "Good afternoon", "Good evening", "Good night")
 *  - Personalized greeting with optional user name ("Good evening, Ushanth")
 *  - Motivational and contextual subtitles based on task completion and time
 *  - Icon identifiers and color themes matching the time of day
 */

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export type GreetingIconName = "sunrise" | "sun" | "sunset" | "moon";

export interface TimeOfDayTheme {
  timeOfDay: TimeOfDay;
  icon: GreetingIconName;
  accentColor: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
}

export interface SubtextOptions {
  remaining?: number;
  completed?: number;
  timeOfDay?: TimeOfDay;
  hour?: number;
}

export interface DynamicGreetingData {
  timeOfDay: TimeOfDay;
  greetingPhrase: string;
  name: string | null;
  fullGreeting: string;
  subtext: string;
  iconName: GreetingIconName;
  formattedDate: string;
}

/**
 * Classifies an hour of day (0-23) into a TimeOfDay segment:
 *  - 05:00 - 11:59: "morning"
 *  - 12:00 - 16:59: "afternoon"
 *  - 17:00 - 21:59: "evening"
 *  - 22:00 - 04:59: "night"
 */
export function getTimeOfDay(hour: number): TimeOfDay {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

/**
 * Returns the base greeting phrase for a time of day.
 */
export function getGreetingPhrase(timeOfDay: TimeOfDay): string {
  switch (timeOfDay) {
    case "morning":
      return "Good morning";
    case "afternoon":
      return "Good afternoon";
    case "evening":
      return "Good evening";
    case "night":
      return "Good night";
  }
}

/**
 * Formats a personalized greeting with optional name.
 */
export function formatGreeting(phrase: string, name?: string | null): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return phrase;
  return `${phrase}, ${trimmed}`;
}

/**
 * Returns the greeting for a specific hour and optional name.
 */
export function getGreeting(options?: {
  hour?: number;
  name?: string | null;
  timeOfDay?: TimeOfDay;
}): string {
  const timeOfDay =
    options?.timeOfDay ??
    (options?.hour !== undefined
      ? getTimeOfDay(options.hour)
      : getTimeOfDay(new Date().getHours()));
  const phrase = getGreetingPhrase(timeOfDay);
  return formatGreeting(phrase, options?.name);
}

/**
 * Returns the associated Lucide icon name for the time of day.
 */
export function getGreetingIconName(timeOfDay: TimeOfDay): GreetingIconName {
  switch (timeOfDay) {
    case "morning":
      return "sunrise";
    case "afternoon":
      return "sun";
    case "evening":
      return "sunset";
    case "night":
      return "moon";
  }
}

/**
 * Returns visual styling parameters for the time-of-day badge.
 */
export function getTimeOfDayTheme(timeOfDay: TimeOfDay): TimeOfDayTheme {
  switch (timeOfDay) {
    case "morning":
      return {
        timeOfDay,
        icon: "sunrise",
        accentColor: "text-amber-500 dark:text-amber-400",
        badgeBg: "bg-amber-50 dark:bg-amber-950/40",
        badgeBorder: "border-amber-200/80 dark:border-amber-800/40",
        badgeText: "text-amber-700 dark:text-amber-300",
      };
    case "afternoon":
      return {
        timeOfDay,
        icon: "sun",
        accentColor: "text-sky-500 dark:text-sky-400",
        badgeBg: "bg-sky-50 dark:bg-sky-950/40",
        badgeBorder: "border-sky-200/80 dark:border-sky-800/40",
        badgeText: "text-sky-700 dark:text-sky-300",
      };
    case "evening":
      return {
        timeOfDay,
        icon: "sunset",
        accentColor: "text-orange-500 dark:text-orange-400",
        badgeBg: "bg-orange-50 dark:bg-orange-950/40",
        badgeBorder: "border-orange-200/80 dark:border-orange-800/40",
        badgeText: "text-orange-700 dark:text-orange-300",
      };
    case "night":
      return {
        timeOfDay,
        icon: "moon",
        accentColor: "text-indigo-500 dark:text-indigo-400",
        badgeBg: "bg-indigo-50 dark:bg-indigo-950/40",
        badgeBorder: "border-indigo-200/80 dark:border-indigo-800/40",
        badgeText: "text-indigo-700 dark:text-indigo-300",
      };
  }
}

/**
 * Generates an inspiring, contextual subtitle reflecting current task load and time of day.
 */
export function getGreetingSubtext(options: SubtextOptions = {}): string {
  const { remaining, completed } = options;
  const timeOfDay =
    options.timeOfDay ??
    (options.hour !== undefined
      ? getTimeOfDay(options.hour)
      : getTimeOfDay(new Date().getHours()));

  const hasRemaining = typeof remaining === "number";
  const hasCompleted = typeof completed === "number";

  if (!hasRemaining && !hasCompleted) {
    switch (timeOfDay) {
      case "morning":
        return "Have a productive and focused day ahead.";
      case "afternoon":
        return "Keep up the momentum this afternoon.";
      case "evening":
        return "Time to wrap up and reflect on your progress.";
      case "night":
        return "Time to rest and recharge for tomorrow.";
    }
  }

  const rem = Math.max(0, remaining ?? 0);
  const comp = Math.max(0, completed ?? 0);

  // All tasks completed for today
  if (rem === 0 && comp > 0) {
    if (timeOfDay === "night") {
      return "All tasks wrapped up. Time to unwind and rest!";
    }
    if (timeOfDay === "evening") {
      return "All tasks completed! Enjoy a relaxing evening.";
    }
    return "All tasks completed! Fantastic job getting ahead today.";
  }

  // No tasks at all scheduled
  if (rem === 0 && comp === 0) {
    return "No tasks scheduled for today. Take it easy or set a new goal!";
  }

  // Some completed and some remaining
  if (rem > 0 && comp > 0) {
    if (rem === 1) {
      return `Almost there! ${comp} done, just 1 task left for today.`;
    }
    return `Great momentum! ${comp} completed, ${rem} to go.`;
  }

  // None completed yet, remaining tasks exist
  if (rem === 1) {
    switch (timeOfDay) {
      case "morning":
        return "Ready to begin? You have 1 task on your agenda today.";
      case "afternoon":
        return "1 task waiting on your schedule this afternoon.";
      case "evening":
        return "Wrapping up today with 1 task remaining.";
      case "night":
        return "Working late? 1 task left on your list.";
    }
  }

  // rem > 1 and none completed yet
  switch (timeOfDay) {
    case "morning":
      return `Ready to start? You have ${rem} tasks ahead today.`;
    case "afternoon":
      return `Keep pushing forward! You have ${rem} tasks remaining today.`;
    case "evening":
      return `Wrapping up your day with ${rem} tasks remaining.`;
    case "night":
      return `Burning the midnight oil? ${rem} tasks remaining.`;
  }
}

/**
 * Formats a Date object into human-readable string: e.g. "Thursday, October 15"
 */
export function formatGreetingDate(date: Date = new Date(), locale: string = "en-US"): string {
  return date.toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Aggregates all greeting information into a single unified object.
 */
export function getDynamicGreetingData(
  options: {
    date?: Date;
    hour?: number;
    remaining?: number;
    completed?: number;
    name?: string | null;
    locale?: string;
  } = {}
): DynamicGreetingData {
  const date = options.date ?? new Date();
  const hour = options.hour ?? date.getHours();
  const timeOfDay = getTimeOfDay(hour);
  const greetingPhrase = getGreetingPhrase(timeOfDay);
  const name = options.name ? options.name.trim() : null;
  const fullGreeting = formatGreeting(greetingPhrase, name);
  const subtext = getGreetingSubtext({
    remaining: options.remaining,
    completed: options.completed,
    timeOfDay,
    hour,
  });
  const iconName = getGreetingIconName(timeOfDay);
  const formattedDate = formatGreetingDate(date, options.locale);

  return {
    timeOfDay,
    greetingPhrase,
    name,
    fullGreeting,
    subtext,
    iconName,
    formattedDate,
  };
}

