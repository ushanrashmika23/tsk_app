import { describe, expect, it } from "vitest";
import {
  getTimeOfDay,
  getGreetingPhrase,
  formatGreeting,
  getGreeting,
  getGreetingIconName,
  getTimeOfDayTheme,
  getGreetingSubtext,
  formatGreetingDate,
  getDynamicGreetingData,
} from "@/lib/greetings";

describe("Dynamic Greeting System", () => {
  describe("getTimeOfDay", () => {
    it("identifies morning between 05:00 and 11:59", () => {
      expect(getTimeOfDay(5)).toBe("morning");
      expect(getTimeOfDay(8)).toBe("morning");
      expect(getTimeOfDay(11)).toBe("morning");
      expect(getTimeOfDay(11.9)).toBe("morning");
    });

    it("identifies afternoon between 12:00 and 16:59", () => {
      expect(getTimeOfDay(12)).toBe("afternoon");
      expect(getTimeOfDay(14)).toBe("afternoon");
      expect(getTimeOfDay(16)).toBe("afternoon");
      expect(getTimeOfDay(16.5)).toBe("afternoon");
    });

    it("identifies evening between 17:00 and 21:59", () => {
      expect(getTimeOfDay(17)).toBe("evening");
      expect(getTimeOfDay(19)).toBe("evening");
      expect(getTimeOfDay(21)).toBe("evening");
    });

    it("identifies night between 22:00 and 04:59", () => {
      expect(getTimeOfDay(22)).toBe("night");
      expect(getTimeOfDay(23)).toBe("night");
      expect(getTimeOfDay(0)).toBe("night");
      expect(getTimeOfDay(2)).toBe("night");
      expect(getTimeOfDay(4)).toBe("night");
    });

    it("normalizes out-of-range hours gracefully", () => {
      expect(getTimeOfDay(24)).toBe("night"); // 00:00
      expect(getTimeOfDay(-1)).toBe("night"); // 23:00
      expect(getTimeOfDay(29)).toBe("morning"); // 05:00
    });
  });

  describe("getGreetingPhrase", () => {
    it("returns correct greeting text for each period", () => {
      expect(getGreetingPhrase("morning")).toBe("Good morning");
      expect(getGreetingPhrase("afternoon")).toBe("Good afternoon");
      expect(getGreetingPhrase("evening")).toBe("Good evening");
      expect(getGreetingPhrase("night")).toBe("Good night");
    });
  });

  describe("formatGreeting", () => {
    it("returns phrase when name is null, undefined, or empty", () => {
      expect(formatGreeting("Good morning")).toBe("Good morning");
      expect(formatGreeting("Good morning", null)).toBe("Good morning");
      expect(formatGreeting("Good morning", undefined)).toBe("Good morning");
      expect(formatGreeting("Good morning", "")).toBe("Good morning");
      expect(formatGreeting("Good morning", "   ")).toBe("Good morning");
    });

    it("appends trimmed name with comma", () => {
      expect(formatGreeting("Good morning", "Alex")).toBe("Good morning, Alex");
      expect(formatGreeting("Good evening", "  Ushanth  ")).toBe("Good evening, Ushanth");
    });
  });

  describe("getGreeting", () => {
    it("resolves greeting based on hour", () => {
      expect(getGreeting({ hour: 9 })).toBe("Good morning");
      expect(getGreeting({ hour: 13 })).toBe("Good afternoon");
      expect(getGreeting({ hour: 18 })).toBe("Good evening");
      expect(getGreeting({ hour: 23 })).toBe("Good night");
    });

    it("includes user name when provided", () => {
      expect(getGreeting({ hour: 9, name: "Sarah" })).toBe("Good morning, Sarah");
      expect(getGreeting({ hour: 20, name: "David" })).toBe("Good evening, David");
    });

    it("respects explicit timeOfDay override", () => {
      expect(getGreeting({ timeOfDay: "morning", name: "Alex" })).toBe("Good morning, Alex");
    });
  });

  describe("getGreetingIconName & getTimeOfDayTheme", () => {
    it("returns appropriate icon for each period", () => {
      expect(getGreetingIconName("morning")).toBe("sunrise");
      expect(getGreetingIconName("afternoon")).toBe("sun");
      expect(getGreetingIconName("evening")).toBe("sunset");
      expect(getGreetingIconName("night")).toBe("moon");
    });

    it("returns complete theme metadata", () => {
      const morningTheme = getTimeOfDayTheme("morning");
      expect(morningTheme.icon).toBe("sunrise");
      expect(morningTheme.accentColor).toContain("amber");

      const nightTheme = getTimeOfDayTheme("night");
      expect(nightTheme.icon).toBe("moon");
      expect(nightTheme.accentColor).toContain("indigo");
    });
  });

  describe("getGreetingSubtext", () => {
    it("returns default period message when no task counts are given", () => {
      expect(getGreetingSubtext({ timeOfDay: "morning" })).toContain("productive");
      expect(getGreetingSubtext({ timeOfDay: "afternoon" })).toContain("momentum");
      expect(getGreetingSubtext({ timeOfDay: "evening" })).toContain("wrap up");
      expect(getGreetingSubtext({ timeOfDay: "night" })).toContain("rest");
    });

    it("handles zero scheduled tasks", () => {
      const msg = getGreetingSubtext({ remaining: 0, completed: 0 });
      expect(msg).toMatch(/no tasks scheduled/i);
    });

    it("handles all tasks completed", () => {
      const morning = getGreetingSubtext({ remaining: 0, completed: 4, timeOfDay: "morning" });
      expect(morning).toMatch(/all tasks completed/i);

      const evening = getGreetingSubtext({ remaining: 0, completed: 2, timeOfDay: "evening" });
      expect(evening).toMatch(/relaxing evening/i);

      const night = getGreetingSubtext({ remaining: 0, completed: 3, timeOfDay: "night" });
      expect(night).toMatch(/unwind and rest/i);
    });

    it("handles partial progress (both completed and remaining > 0)", () => {
      const msgMultiple = getGreetingSubtext({ remaining: 3, completed: 2 });
      expect(msgMultiple).toContain("2 completed, 3 to go");

      const msgOneLeft = getGreetingSubtext({ remaining: 1, completed: 4 });
      expect(msgOneLeft).toContain("just 1 task left");
    });

    it("handles starting out with single remaining task", () => {
      expect(getGreetingSubtext({ remaining: 1, completed: 0, timeOfDay: "morning" })).toContain(
        "1 task on your agenda"
      );
      expect(getGreetingSubtext({ remaining: 1, completed: 0, timeOfDay: "afternoon" })).toContain(
        "1 task waiting"
      );
      expect(getGreetingSubtext({ remaining: 1, completed: 0, timeOfDay: "evening" })).toContain(
        "1 task remaining"
      );
      expect(getGreetingSubtext({ remaining: 1, completed: 0, timeOfDay: "night" })).toContain(
        "1 task left"
      );
    });

    it("handles starting out with multiple remaining tasks", () => {
      expect(getGreetingSubtext({ remaining: 5, completed: 0, timeOfDay: "morning" })).toContain(
        "5 tasks ahead"
      );
      expect(getGreetingSubtext({ remaining: 4, completed: 0, timeOfDay: "afternoon" })).toContain(
        "4 tasks remaining"
      );
      expect(getGreetingSubtext({ remaining: 3, completed: 0, timeOfDay: "night" })).toContain(
        "Burning the midnight oil"
      );
    });
  });

  describe("formatGreetingDate", () => {
    it("formats standard human-readable date", () => {
      const fixedDate = new Date(Date.UTC(2026, 9, 15, 12, 0, 0));
      const str = formatGreetingDate(fixedDate);
      expect(str).toContain("October");
    });
  });

  describe("getDynamicGreetingData", () => {
    it("combines all dynamic properties into a single payload", () => {
      const fixedDate = new Date(2026, 9, 15, 14, 30, 0);
      const data = getDynamicGreetingData({
        date: fixedDate,
        hour: 14,
        remaining: 2,
        completed: 1,
        name: "Alex",
      });

      expect(data.timeOfDay).toBe("afternoon");
      expect(data.greetingPhrase).toBe("Good afternoon");
      expect(data.fullGreeting).toBe("Good afternoon, Alex");
      expect(data.name).toBe("Alex");
      expect(data.iconName).toBe("sun");
      expect(data.subtext).toContain("1 completed, 2 to go");
      expect(data.formattedDate).toBeDefined();
    });
  });
});

