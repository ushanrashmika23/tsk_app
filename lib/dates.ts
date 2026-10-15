/**
 * Centralised, timezone-aware date & time utilities.
 *
 * Conventions used across the application and the AI tools:
 *
 *  - A "civil date" is a calendar day in the application timezone, always
 *    represented as a `YYYY-MM-DD` string. It is never derived from a
 *    `Date` object's host-local getters, because the server timezone is not
 *    guaranteed to match the application timezone (Vercel runs in UTC).
 *  - `scheduled_time` is stored as `HH:MM` (24 hour) in the application
 *    timezone, or `null` when the user did not specify a time.
 *  - `created_at` / `updated_at` / `completed_at` are absolute instants
 *    stored as ISO-8601 UTC strings.
 *
 * Every relative-date decision the AI needs is resolved here rather than by
 * the model, so the model only forwards the user's own words.
 */

export const APP_TIMEZONE = (process.env.APP_TIMEZONE || "").trim() || "Asia/Colombo";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_LOOSE_RE = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/;
const TIME_24_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const MS_PER_DAY = 86_400_000;

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  a: 1,
  an: 1,
};

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday */
  weekdayIndex: number;
  weekdayName: string;
}

export type DateExprStatus = "resolved" | "missing" | "invalid";
export type RangeExprStatus = "resolved" | "missing" | "invalid";

export interface ResolvedDate {
  status: "resolved";
  /** `YYYY-MM-DD` in the application timezone. */
  date: string;
  /** The substring of the user's text that produced this date. */
  matched: string;
  /** Human explanation, useful for the model's final answer and for logging. */
  interpretation: string;
}

export interface UnresolvedDate {
  status: "missing" | "invalid";
  matched?: string;
  reason?: string;
}

export type DateResolution = ResolvedDate | UnresolvedDate;

export interface ResolvedRange {
  status: "resolved";
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  end: string;
  matched: string;
  interpretation: string;
}

export interface UnresolvedRange {
  status: "missing" | "invalid";
  matched?: string;
  reason?: string;
}

export type RangeResolution = ResolvedRange | UnresolvedRange;

export interface ResolvedTime {
  status: "resolved";
  /** `HH:MM` 24 hour. */
  time: string;
  matched: string;
  /** True when the time came from a vague word such as "evening". */
  approximate: boolean;
}

export type TimeResolution = ResolvedTime | UnresolvedDate;

/* ------------------------------------------------------------------ */
/* Civil date primitives                                               */
/* ------------------------------------------------------------------ */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Number of days in a Gregorian month (1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Strict `YYYY-MM-DD` validation. Rejects well-formed but impossible dates
 * such as `2026-02-30` or `2026-13-01`.
 */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_RE.exec(value.trim());
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/** `true` for `HH:MM` (24 hour) with an optional seconds component. */
export function isValidTime24(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = TIME_24_RE.exec(value.trim());
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59;
}

/** Normalises any accepted time spelling to `HH:MM`, or `null` if invalid. */
export function normalizeTime24(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return null;

  const m = TIME_24_RE.exec(trimmed);
  if (m) return `${pad2(Number(m[1]))}:${pad2(Number(m[2]))}`;

  return parseClockExpression(trimmed)?.time ?? null;
}

/** Parses `YYYY-MM-DD` into a `Date` anchored at UTC midnight (DST-free math). */
export function isoToUTCDate(iso: string): Date {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function utcDateToISO(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Adds whole days to a civil date. Month, year and leap-year safe. */
export function addDaysISO(iso: string, days: number): string {
  const d = isoToUTCDate(iso);
  return utcDateToISO(new Date(d.getTime() + days * MS_PER_DAY));
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDaysISO(a: string, b: string): number {
  return Math.round((isoToUTCDate(b).getTime() - isoToUTCDate(a).getTime()) / MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayIndex(iso: string): number {
  return isoToUTCDate(iso).getUTCDay();
}

export function weekdayName(iso: string): string {
  return WEEKDAY_NAMES[weekdayIndex(iso)];
}

export function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT[weekdayIndex(iso)];
}

/** Monday-based week start (ISO-8601 convention). */
export function startOfWeekISO(iso: string): string {
  const idx = weekdayIndex(iso);
  const offset = idx === 0 ? -6 : 1 - idx;
  return addDaysISO(iso, offset);
}

export function endOfWeekISO(iso: string): string {
  return addDaysISO(startOfWeekISO(iso), 6);
}

export function startOfMonthISO(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonthISO(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${iso.slice(0, 7)}-${pad2(daysInMonth(y, m))}`;
}

/**
 * Resolves any date-ish input to `YYYY-MM-DD`:
 * `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY.MM.DD`, or a `Date` instant evaluated in
 * the application timezone. Returns `null` for anything else.
 */
export function coerceToISODate(value: unknown, tz: string = APP_TIMEZONE): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toISODate(value, tz);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (isValidISODate(trimmed)) return trimmed;
  const loose = ISO_DATE_LOOSE_RE.exec(trimmed);
  if (loose) {
    const candidate = `${loose[1]}-${pad2(Number(loose[2]))}-${pad2(Number(loose[3]))}`;
    return isValidISODate(candidate) ? candidate : null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Reading the current instant in a timezone                           */
/* ------------------------------------------------------------------ */

/**
 * Returns the civil date and wall-clock time of `instant` in `tz`.
 *
 * Uses `Intl` with the `h23` hour cycle so midnight is reported as hour 0
 * (the `hour12: false` shorthand reports hour 24 in some ICU builds).
 */
export function getZonedParts(instant: Date = new Date(), tz: string = APP_TIMEZONE): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const iso = `${year}-${pad2(month)}-${pad2(day)}`;

  return {
    year,
    month,
    day,
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekdayIndex: weekdayIndex(iso),
    weekdayName: WEEKDAY_NAMES[weekdayIndex(iso)],
  };
}

/** The civil date of an instant in the given timezone. */
export function toISODate(instant: Date = new Date(), tz: string = APP_TIMEZONE): string {
  const p = getZonedParts(instant, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function todayISO(tz: string = APP_TIMEZONE, now: Date = new Date()): string {
  return toISODate(now, tz);
}

export function nowTime24(tz: string = APP_TIMEZONE, now: Date = new Date()): string {
  const p = getZonedParts(now, tz);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

export interface NowSnapshot {
  iso: string;
  time24: string;
  time12: string;
  weekday: string;
  timezone: string;
  /** ISO-8601 instant, always UTC. */
  instant: string;
}

export function nowSnapshot(tz: string = APP_TIMEZONE, now: Date = new Date()): NowSnapshot {
  const p = getZonedParts(now, tz);
  return {
    iso: toISODate(now, tz),
    time24: `${pad2(p.hour)}:${pad2(p.minute)}`,
    time12: formatTime12(`${pad2(p.hour)}:${pad2(p.minute)}`) ?? "",
    weekday: p.weekdayName,
    timezone: tz,
    instant: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatTime12(time24: string): string | null {
  const normalized = normalizeTime24(time24);
  if (!normalized) return null;
  const [h, m] = normalized.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad2(m)} ${period}`;
}

/** `Fri 17 Oct` style label, with `today` / `tomorrow` shortcuts. */
export function humanizeDate(iso: string, referenceISO?: string): string {
  if (!isValidISODate(iso)) return iso;
  if (referenceISO && isValidISODate(referenceISO)) {
    const delta = diffDaysISO(referenceISO, iso);
    if (delta === 0) return "today";
    if (delta === 1) return "tomorrow";
    if (delta === -1) return "yesterday";
  }
  const [, m, d] = iso.split("-").map(Number);
  return `${weekdayShort(iso)} ${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

/** Compact, token-efficient calendar block handed to the model. */
export function buildCalendarContext(tz: string = APP_TIMEZONE, now: Date = new Date()): string {
  const today = todayISO(tz, now);
  const snap = nowSnapshot(tz, now);
  const lines = [`Today is ${today} (${snap.weekday}), current time ${snap.time12} ${tz}.`];

  const upcoming = [1, 2, 3, 4, 5, 6, 7]
    .map((offset) => {
      const iso = addDaysISO(today, offset);
      return `${iso}=${weekdayShort(iso)} (${offset === 1 ? "tomorrow" : `in ${offset} days`})`;
    })
    .join(", ");
  lines.push(`Upcoming dates: ${upcoming}.`);

  const weekStart = startOfWeekISO(today);
  lines.push(
    `This week runs ${weekStart} to ${endOfWeekISO(today)}; next week starts ${addDaysISO(weekStart, 7)}.`
  );

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Natural language date expressions                                   */
/* ------------------------------------------------------------------ */

function numberFromWord(raw: string): number | null {
  const token = raw.trim().toLowerCase();
  if (/^\d+$/.test(token)) return Number(token);
  return WORD_NUMBERS[token] ?? null;
}

function monthIndexFromName(raw: string): number | null {
  const token = raw.trim().toLowerCase().replace(/\.$/, "");
  if (token.length < 3) return null;
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase().startsWith(token));
  return idx === -1 ? null : idx;
}

/**
 * Chooses the year for a month/day given without one. Uses the current year,
 * rolling forward when the date is far enough in the past that the user
 * almost certainly means next year.
 */
function inferYear(month: number, day: number, todayIso: string): string {
  const [year] = todayIso.split("-").map(Number);
  const candidate = `${year}-${pad2(month)}-${pad2(day)}`;
  if (!isValidISODate(candidate)) return candidate;
  return diffDaysISO(todayIso, candidate) < -183 ? `${year + 1}-${pad2(month)}-${pad2(day)}` : candidate;
}

function nextWeekdayFrom(todayIso: string, targetIndex: number, mode: "next" | "this" | "bare"): string {
  const current = weekdayIndex(todayIso);
  if (mode === "next") {
    // "next Friday" means the Friday of the *following* week, not the next
    // Friday to occur. Spoken on a Thursday, "next Friday" is eight days away;
    // the coming tomorrow would be "this Friday" or "tomorrow". Weeks are
    // Monday-based, matching `startOfWeekISO`.
    const upcoming = addDaysISO(todayIso, ((targetIndex - current + 7 - 1) % 7) + 1);
    // Still inside the current week? Then it is not "next" anything.
    return diffDaysISO(upcoming, endOfWeekISO(todayIso)) >= 0 ? addDaysISO(upcoming, 7) : upcoming;
  }
  if (mode === "this") {
    // "this Monday" includes today when today already is Monday.
    const delta = (targetIndex - current + 7) % 7;
    return addDaysISO(todayIso, delta);
  }
  // Bare "on Friday" means the upcoming Friday, today included.
  const delta = (targetIndex - current + 7) % 7;
  return addDaysISO(todayIso, delta);
}

const WEEKDAY_PATTERN =
  /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i;

/**
 * Resolves a natural-language date expression to a civil date.
 *
 * Returns `status: "missing"` when the text contains no date at all, and
 * `status: "invalid"` when it contains something date-like that cannot be
 * resolved safely (so the caller can ask a clarifying question instead of
 * guessing).
 */
export function resolveDateExpression(
  input: unknown,
  options: { today?: string; tz?: string; now?: Date } = {}
): DateResolution {
  if (typeof input !== "string" || input.trim() === "") {
    return { status: "missing" };
  }

  const tz = options.tz ?? APP_TIMEZONE;
  const today = options.today ?? todayISO(tz, options.now ?? new Date());
  const text = input.trim();
  const lower = text.toLowerCase();

  // 1. Explicit ISO / slash / dot dates.
  const isoMatch = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text);
  if (isoMatch) {
    const candidate = `${isoMatch[1]}-${pad2(Number(isoMatch[2]))}-${pad2(Number(isoMatch[3]))}`;
    if (!isValidISODate(candidate)) {
      return { status: "invalid", matched: isoMatch[0], reason: `"${isoMatch[0]}" is not a real calendar date.` };
    }
    return { status: "resolved", date: candidate, matched: isoMatch[0], interpretation: candidate };
  }

  // 2. Month-name forms: "Oct 20", "October 20 2026", "20 Oct", "the 20th of October".
  const monthFirst =
    /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/i.exec(text) ??
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?(?:\s*,?\s*(\d{4}))?\b/i.exec(text);

  if (monthFirst) {
    const monthToken = /[a-z]/i.test(monthFirst[1]) ? monthFirst[1] : monthFirst[2];
    const dayToken = /[a-z]/i.test(monthFirst[1]) ? monthFirst[2] : monthFirst[1];
    const explicitYear = monthFirst[3];
    const month = monthIndexFromName(monthToken);
    if (month !== null) {
      const day = Number(dayToken);
      const iso = explicitYear
        ? `${explicitYear}-${pad2(month + 1)}-${pad2(day)}`
        : inferYear(month + 1, day, today);
      if (!isValidISODate(iso)) {
        return { status: "invalid", matched: monthFirst[0], reason: `"${monthFirst[0]}" is not a real calendar date.` };
      }
      return { status: "resolved", date: iso, matched: monthFirst[0], interpretation: `resolved to ${iso}` };
    }
  }

  // 3. Day-of-month only: "the 20th".
  const dayOnly = /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text);
  if (dayOnly && !WEEKDAY_PATTERN.test(text)) {
    const day = Number(dayOnly[1]);
    if (day < 1 || day > 31) {
      return { status: "invalid", matched: dayOnly[0], reason: `Day ${day} is out of range.` };
    }
    const [, currentMonth] = today.split("-").map(Number);
    let iso = inferYear(currentMonth, day, today);
    if (!isValidISODate(iso)) {
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      iso = inferYear(nextMonth, day, today);
    }
    if (!isValidISODate(iso)) {
      return { status: "invalid", matched: dayOnly[0], reason: `"${dayOnly[0]}" does not match a real day this month.` };
    }
    // A bare day number that already passed refers to next month.
    if (diffDaysISO(today, iso) < 0) {
      const [y, m] = iso.split("-").map(Number);
      const rolled = m === 12 ? `${y + 1}-01-${pad2(day)}` : `${y}-${pad2(m + 1)}-${pad2(day)}`;
      if (isValidISODate(rolled)) iso = rolled;
    }
    return { status: "resolved", date: iso, matched: dayOnly[0], interpretation: `resolved to ${iso}` };
  }

  // 4. Relative keywords.
  if (/\b(today|tonight)\b/i.test(lower)) {
    return { status: "resolved", date: today, matched: lower.match(/\b(today|tonight)\b/i)![0], interpretation: "today" };
  }
  if (/\b(tomorrow|tmrw|tmw|tom)\b/i.test(lower)) {
    const date = addDaysISO(today, 1);
    return { status: "resolved", date, matched: "tomorrow", interpretation: "tomorrow" };
  }
  if (/\b(yesterday)\b/i.test(lower)) {
    const date = addDaysISO(today, -1);
    return { status: "resolved", date, matched: "yesterday", interpretation: "yesterday" };
  }
  if (/\bday after tomorrow\b/i.test(lower)) {
    const date = addDaysISO(today, 2);
    return { status: "resolved", date, matched: "day after tomorrow", interpretation: "day after tomorrow" };
  }

  // 5. "in N days / weeks / months".
  const inMatch = /\bin\s+([a-z0-9]+)\s+(day|days|week|weeks|month|months)\b/i.exec(lower);
  if (inMatch) {
    const amount = numberFromWord(inMatch[1]);
    if (amount === null) {
      return { status: "invalid", matched: inMatch[0], reason: `Could not read the amount in "${inMatch[0]}".` };
    }
    const unit = inMatch[2].toLowerCase();
    let date: string;
    if (unit.startsWith("day")) date = addDaysISO(today, amount);
    else if (unit.startsWith("week")) date = addDaysISO(today, amount * 7);
    else {
      const [y, m, d] = today.split("-").map(Number);
      const target = new Date(Date.UTC(y, m - 1 + amount, 1));
      const lastDay = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
      date = `${target.getUTCFullYear()}-${pad2(target.getUTCMonth() + 1)}-${pad2(Math.min(d, lastDay))}`;
    }
    return { status: "resolved", date, matched: inMatch[0], interpretation: `resolved to ${date}` };
  }

  // 6. Weekends.
  if (/\b(this|the|coming)?\s*weekend\b/i.test(lower)) {
    const current = weekdayIndex(today);
    const date = current === 6 || current === 0 ? today : addDaysISO(today, 6 - current);
    return { status: "resolved", date, matched: "weekend", interpretation: `Saturday ${date}` };
  }

  // 7. Weekday names, with an optional `next` / `this` qualifier.
  const weekdayMatch = WEEKDAY_PATTERN.exec(lower);
  if (weekdayMatch) {
    const token = weekdayMatch[1].toLowerCase();
    const targetIndex = WEEKDAY_NAMES.findIndex(
      (name) => name.toLowerCase().startsWith(token.slice(0, 3)) && name.toLowerCase().startsWith(token)
    );
    const resolvedIndex =
      targetIndex !== -1
        ? targetIndex
        : WEEKDAY_SHORT.findIndex((name) => name.toLowerCase() === token.slice(0, 3));
    if (resolvedIndex === -1) {
      return { status: "invalid", matched: weekdayMatch[0], reason: `Unknown weekday "${weekdayMatch[0]}".` };
    }

    const preceding = lower.slice(Math.max(0, weekdayMatch.index - 12), weekdayMatch.index);
    const mode: "next" | "this" | "bare" = /\bnext\s*$/.test(preceding)
      ? "next"
      : /\bthis\s*$/.test(preceding)
        ? "this"
        : "bare";

    const date = nextWeekdayFrom(today, resolvedIndex, mode);
    return {
      status: "resolved",
      date,
      matched: weekdayMatch[0],
      interpretation: `${mode === "next" ? "next " : mode === "this" ? "this " : ""}${WEEKDAY_NAMES[resolvedIndex]} = ${date}`,
    };
  }

  // 8. Nothing date-like present.
  return { status: "missing" };
}

/**
 * Resolves a natural-language *range* such as "this week", "next week",
 * "later this week", "this weekend" or "this month". Falls back to
 * `resolveDateExpression` for single-day phrases.
 */
export function resolveDateRangeExpression(
  input: unknown,
  options: { today?: string; tz?: string; now?: Date } = {}
): RangeResolution {
  if (typeof input !== "string" || input.trim() === "") {
    return { status: "missing" };
  }

  const tz = options.tz ?? APP_TIMEZONE;
  const today = options.today ?? todayISO(tz, options.now ?? new Date());
  const lower = input.trim().toLowerCase();

  if (/\bnext\s+week\b/.test(lower)) {
    const start = addDaysISO(startOfWeekISO(today), 7);
    return { status: "resolved", start, end: addDaysISO(start, 6), matched: "next week", interpretation: `next week ${start}..${addDaysISO(start, 6)}` };
  }
  if (/\bnext\s+month\b/.test(lower)) {
    const [y, m] = today.split("-").map(Number);
    const start = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
    return { status: "resolved", start, end: endOfMonthISO(start), matched: "next month", interpretation: `next month ${start}..${endOfMonthISO(start)}` };
  }
  if (/\bthis\s+month\b/.test(lower)) {
    return { status: "resolved", start: startOfMonthISO(today), end: endOfMonthISO(today), matched: "this month", interpretation: `this month` };
  }
  if (/\b(later this week|rest of (the )?week|this week)\b/.test(lower)) {
    return {
      status: "resolved",
      start: today,
      end: endOfWeekISO(today),
      matched: lower.match(/\b(later this week|rest of (the )?week|this week)\b/)![0],
      interpretation: `today through end of week (${today}..${endOfWeekISO(today)})`,
    };
  }
  if (/\b(this|the|coming)?\s*weekend\b/.test(lower)) {
    const current = weekdayIndex(today);
    const saturday = current === 6 || current === 0 ? today : addDaysISO(today, 6 - current);
    return { status: "resolved", start: saturday, end: addDaysISO(saturday, 1), matched: "weekend", interpretation: `weekend ${saturday}..${addDaysISO(saturday, 1)}` };
  }

  const single = resolveDateExpression(input, options);
  if (single.status === "resolved") {
    return { status: "resolved", start: single.date, end: single.date, matched: single.matched, interpretation: single.interpretation };
  }
  return single.status === "invalid"
    ? { status: "invalid", matched: single.matched, reason: single.reason }
    : { status: "missing" };
}

/* ------------------------------------------------------------------ */
/* Natural language time expressions                                   */
/* ------------------------------------------------------------------ */

const TIME_OF_DAY_DEFAULTS: Array<{ pattern: RegExp; time: string; label: string }> = [
  { pattern: /\b(midnight)\b/i, time: "00:00", label: "midnight" },
  { pattern: /\b(noon|midday)\b/i, time: "12:00", label: "noon" },
  { pattern: /\b(this\s+)?morning\b/i, time: "09:00", label: "morning" },
  { pattern: /\b(this\s+)?afternoon\b/i, time: "14:00", label: "afternoon" },
  { pattern: /\b(this\s+)?(evening|tonight)\b/i, time: "18:00", label: "evening" },
  { pattern: /\b(tonight|night)\b/i, time: "20:00", label: "night" },
];

function parseClockExpression(raw: string): { time: string; approximate: boolean } | null {
  const text = raw.trim().toLowerCase().replace(/\./g, ":").replace(/\s+/g, " ");

  // 24-hour form, optionally with a period suffix ("19:00", "7:30 pm").
  const clock = /^(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(text);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2]);
    const period = clock[3]?.replace(/\./g, "");
    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    return { time: `${pad2(hour)}:${pad2(minute)}`, approximate: false };
  }

  // Bare hour with a period, or a 24-hour hour on its own ("7 pm", "at 7", "19").
  const hourOnly = /^(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(text);
  if (hourOnly) {
    let hour = Number(hourOnly[1]);
    const period = hourOnly[2]?.replace(/\./g, "");
    if (period === "pm") {
      if (hour < 12) hour += 12;
    } else if (period === "am") {
      if (hour === 12) hour = 0;
    } else if (hour <= 7) {
      // "at 7" with no period almost always means the evening for a task app.
      hour += 12;
    }
    if (hour > 23) return null;
    return { time: `${pad2(hour)}:00`, approximate: !period };
  }

  return null;
}

/**
 * Resolves a time expression. Explicit clock times are honoured exactly;
 * vague phrases ("this evening") map to a documented default and are flagged
 * `approximate` so the model can say so.
 */
export function resolveTimeExpression(input: unknown): TimeResolution {
  if (typeof input !== "string" || input.trim() === "") {
    return { status: "missing" };
  }

  const text = input.trim();

  const atMatch = /\b(?:at|by|around|@)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i.exec(text);
  if (atMatch) {
    const parsed = parseClockExpression(atMatch[1]);
    if (!parsed) {
      return { status: "invalid", matched: atMatch[0], reason: `"${atMatch[0]}" is not a time I can read.` };
    }
    return { status: "resolved", time: parsed.time, matched: atMatch[0], approximate: false };
  }

  const oclock = /\b(\d{1,2})\s*o'?\s*clock\s*(am|pm)?\b/i.exec(text);
  if (oclock) {
    const parsed = parseClockExpression(`${oclock[1]} ${oclock[2] ?? ""}`.trim());
    if (parsed) return { status: "resolved", time: parsed.time, matched: oclock[0], approximate: !oclock[2] };
  }

  const standalone = /\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i.exec(text);
  if (standalone) {
    const parsed = parseClockExpression(standalone[1]);
    if (parsed) return { status: "resolved", time: parsed.time, matched: standalone[0], approximate: false };
  }

  // A bare hour *with* a period marker ("9am", "7 pm") is unambiguous, so it is
  // honoured exactly. Requiring the marker is what keeps a stray number in a
  // sentence from being read as a time.
  const meridiem = /\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/i.exec(text);
  if (meridiem) {
    const parsed = parseClockExpression(`${meridiem[1]} ${meridiem[2]}`);
    if (parsed) return { status: "resolved", time: parsed.time, matched: meridiem[0], approximate: false };
  }

  for (const entry of TIME_OF_DAY_DEFAULTS) {
    const match = entry.pattern.exec(text);
    if (match) {
      return { status: "resolved", time: entry.time, matched: match[0], approximate: true };
    }
  }

  return { status: "missing" };
}

export interface ResolvedWhen {
  /** Date resolution, always attempted. */
  date: DateResolution;
  time: TimeResolution;
}

/** Convenience wrapper: resolve a date and a time out of one phrase. */
export function resolveWhen(input: unknown, options: { today?: string; tz?: string; now?: Date } = {}): ResolvedWhen {
  return {
    date: resolveDateExpression(input, options),
    time: resolveTimeExpression(input),
  };
}
