import { describe, expect, it } from "vitest";
import { greeting, relativeTime } from "./time";

describe("greeting", () => {
  it("follows the time of day", () => {
    expect(greeting(new Date(2026, 0, 1, 9))).toBe("Good morning, Hunter.");
    expect(greeting(new Date(2026, 0, 1, 14))).toBe("Good afternoon, Hunter.");
    expect(greeting(new Date(2026, 0, 1, 21))).toBe("Good evening, Hunter.");
    expect(greeting(new Date(2026, 0, 1, 2))).toBe("Still up, Hunter.");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  it("formats the largest unit", () => {
    expect(relativeTime("2026-01-01T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-01-01T11:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-01-01T10:00:00Z", now)).toBe("2 hours ago");
    expect(relativeTime("2025-12-30T12:00:00Z", now)).toBe("2 days ago");
    expect(relativeTime(null, now)).toBe("");
  });
});
