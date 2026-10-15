import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  diffDaysISO,
  endOfWeekISO,
  humanizeDate,
  isValidISODate,
  nowSnapshot,
  resolveDateExpression,
  resolveDateRangeExpression,
  resolveTimeExpression,
  startOfWeekISO,
  todayISO,
  weekdayName,
} from "@/lib/dates";

/**
 * Natural-language date handling (§6).
 *
 * Every case pins `today` explicitly so the tests never depend on the clock,
 * and all arithmetic is civil-date arithmetic in the configured timezone —
 * never the host's local getters.
 */

const REF = "2026-10-15"; // Thursday
const TZ = "Asia/Colombo";

describe("civil date primitives", () => {
  it("treats a date string as a calendar day, not an instant", () => {
    expect(addDaysISO("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
    expect(diffDaysISO("2026-10-15", "2026-10-18")).toBe(3);
    expect(isValidISODate("2026-02-29")).toBe(false);
    expect(isValidISODate("2024-02-29")).toBe(true);
  });

  it("uses Monday as the first day of the week", () => {
    expect(weekdayName(REF)).toBe("Thursday");
    expect(startOfWeekISO(REF)).toBe("2026-10-12");
    expect(endOfWeekISO(REF)).toBe("2026-10-18");
  });

  it("resolves the current civil date in the configured timezone, not the host's", () => {
    // 2026-10-14T20:00Z is already 2026-10-15 01:30 in Asia/Colombo (UTC+5:30).
    const instant = new Date("2026-10-14T20:00:00.000Z");
    expect(todayISO("Asia/Colombo", instant)).toBe("2026-10-15");
    expect(todayISO("UTC", instant)).toBe("2026-10-14");

    const snapshot = nowSnapshot(TZ, instant);
    expect(snapshot.time24).toBe("01:30");
    expect(snapshot.time12).toBe("1:30 AM");
    expect(snapshot.weekday).toBe("Thursday");
  });

  it("stays correct across a DST transition in a zone that observes one", () => {
    // US DST begins 2026-03-08; 05:30Z is 00:30 EST but 01:30 EDT.
    expect(todayISO("America/New_York", new Date("2026-03-08T04:30:00Z"))).toBe("2026-03-07");
    expect(todayISO("America/New_York", new Date("2026-03-08T05:30:00Z"))).toBe("2026-03-08");
    // Sri Lanka has no DST, so the same instants never shift the civil date.
    expect(todayISO(TZ, new Date("2026-03-08T04:30:00Z"))).toBe("2026-03-08");
  });
});

describe("relative date phrases", () => {
  const date = (phrase: string, today = REF) => resolveDateExpression(phrase, { today, tz: TZ });

  it("resolves today / tomorrow / yesterday", () => {
    expect(date("today")).toMatchObject({ status: "resolved", date: "2026-10-15" });
    expect(date("tomorrow")).toMatchObject({ status: "resolved", date: "2026-10-16" });
    expect(date("yesterday")).toMatchObject({ status: "resolved", date: "2026-10-14" });
  });

  it("resolves 'in three days' and other counted offsets", () => {
    expect(date("in three days")).toMatchObject({ status: "resolved", date: "2026-10-18" });
    expect(date("in 2 weeks")).toMatchObject({ status: "resolved", date: "2026-10-29" });
  });

  it("resolves weekday names with next / this qualifiers", () => {
    expect(date("Friday")).toMatchObject({ status: "resolved", date: "2026-10-16" });
    expect(date("this Friday")).toMatchObject({ status: "resolved", date: "2026-10-16" });
    // "next Friday" is the Friday of the following week, not tomorrow.
    expect(date("next Friday")).toMatchObject({ status: "resolved", date: "2026-10-23" });
    expect(date("next Monday")).toMatchObject({ status: "resolved", date: "2026-10-19" });
    // Spoken on a Monday, "next Monday" is a week away.
    expect(date("next Monday", "2026-10-12")).toMatchObject({ status: "resolved", date: "2026-10-19" });
  });

  it("resolves explicit and month-name dates", () => {
    expect(date("2026-11-02")).toMatchObject({ status: "resolved", date: "2026-11-02" });
    expect(date("October 20")).toMatchObject({ status: "resolved", date: "2026-10-20" });
  });

  it("handles month and year boundaries", () => {
    expect(date("tomorrow", "2026-01-31")).toMatchObject({ status: "resolved", date: "2026-02-01" });
    expect(date("tomorrow", "2026-12-31")).toMatchObject({ status: "resolved", date: "2027-01-01" });
    expect(date("yesterday", "2027-01-01")).toMatchObject({ status: "resolved", date: "2026-12-31" });
  });

  it("distinguishes a missing date from an invalid one", () => {
    // Nothing date-like: the caller must ask rather than assume.
    expect(date("buy milk")).toMatchObject({ status: "missing" });
    expect(date("")).toMatchObject({ status: "missing" });
    // Date-like but impossible: a validation failure, not a clarification.
    expect(date("2026-02-30")).toMatchObject({ status: "invalid" });
  });
});

describe("relative range phrases", () => {
  const range = (phrase: string) => resolveDateRangeExpression(phrase, { today: REF, tz: TZ });

  it("resolves this weekend, next week and later this week", () => {
    expect(range("this weekend")).toMatchObject({ status: "resolved", start: "2026-10-17", end: "2026-10-18" });
    expect(range("next week")).toMatchObject({ status: "resolved", start: "2026-10-19", end: "2026-10-25" });
    expect(range("later this week")).toMatchObject({ status: "resolved", start: "2026-10-15", end: "2026-10-18" });
    expect(range("this month")).toMatchObject({ status: "resolved", start: "2026-10-01", end: "2026-10-31" });
  });

  it("resolves 'the first task next week' to next week's window", () => {
    expect(range("the first task next week")).toMatchObject({ start: "2026-10-19", end: "2026-10-25" });
  });

  it("collapses a single-day phrase to a one-day range", () => {
    expect(range("tomorrow")).toMatchObject({ status: "resolved", start: "2026-10-16", end: "2026-10-16" });
  });
});

describe("time phrases", () => {
  it("reads explicit clock times", () => {
    expect(resolveTimeExpression("tomorrow at 7 PM")).toMatchObject({ status: "resolved", time: "19:00" });
    expect(resolveTimeExpression("at 07:30")).toMatchObject({ status: "resolved", time: "07:30" });
    expect(resolveTimeExpression("9am")).toMatchObject({ status: "resolved", time: "09:00" });
  });

  it("maps vague parts of day to documented, flagged defaults", () => {
    const evening = resolveTimeExpression("this evening");
    expect(evening).toMatchObject({ status: "resolved", time: "18:00" });
    expect(evening).toMatchObject({ approximate: true });
    expect(resolveTimeExpression("tomorrow")).toMatchObject({ status: "missing" });
  });

  it("keeps the user's wording for the combined date+time case", () => {
    // The exact sentence from the brief: the date and the time both resolve.
    const when = "remind me to study DSA tomorrow at 7 PM";
    expect(resolveDateExpression(when, { today: REF, tz: TZ })).toMatchObject({ date: "2026-10-16" });
    expect(resolveTimeExpression(when)).toMatchObject({ time: "19:00" });
  });
});

describe("formatting", () => {
  it("labels dates relative to today", () => {
    expect(humanizeDate("2026-10-15", REF)).toBe("today");
    expect(humanizeDate("2026-10-16", REF)).toBe("tomorrow");
    // Further out it uses the compact weekday form the prompt asks for.
    expect(humanizeDate("2026-10-17", REF)).toContain("Sat");
    expect(humanizeDate("2026-10-17", REF)).toContain("17");
  });
});
