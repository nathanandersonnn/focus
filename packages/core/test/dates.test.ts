import { describe, expect, it } from "vitest";
import { dayNumber, isWeekday, mondayOf, nextWeekday, previousWeekday, toLocalDate } from "../src/dates";

describe("dayNumber", () => {
  it("returns 0 for the epoch date 1970-01-01", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
  });

  it("consecutive dates differ by exactly 1", () => {
    const a = dayNumber("2026-09-14");
    const b = dayNumber("2026-09-15");
    expect(b - a).toBe(1);

    const c = dayNumber("2026-09-18");
    const d = dayNumber("2026-09-19");
    expect(d - c).toBe(1);
  });

  it("crosses month end correctly (2026-01-31 -> 2026-02-01)", () => {
    const last = dayNumber("2026-01-31");
    const first = dayNumber("2026-02-01");
    expect(first - last).toBe(1);
  });

  it("crosses leap day correctly (2024-02-28 -> 2024-02-29 -> 2024-03-01)", () => {
    const feb28 = dayNumber("2024-02-28");
    const feb29 = dayNumber("2024-02-29");
    const mar01 = dayNumber("2024-03-01");

    expect(feb29 - feb28).toBe(1);
    expect(mar01 - feb29).toBe(1);
  });
});

describe("toLocalDate", () => {
  it("round-trips with dayNumber for known dates", () => {
    const dates = [
      "1970-01-01",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
      "2026-01-31",
      "2026-02-01",
      "2026-09-14",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ];

    for (const date of dates) {
      const n = dayNumber(date);
      expect(toLocalDate(n)).toBe(date);
    }
  });
});

describe("isWeekday", () => {
  it("returns true for Mon..Fri of the week of 2026-09-14", () => {
    const weekdays = [
      "2026-09-14", // Monday
      "2026-09-15", // Tuesday
      "2026-09-16", // Wednesday
      "2026-09-17", // Thursday
      "2026-09-18", // Friday
    ];

    for (const date of weekdays) {
      expect(isWeekday(dayNumber(date))).toBe(true);
    }
  });

  it("returns false for Saturday and Sunday", () => {
    const saturday = dayNumber("2026-09-19");
    const sunday = dayNumber("2026-09-20");

    expect(isWeekday(saturday)).toBe(false);
    expect(isWeekday(sunday)).toBe(false);
  });
});

describe("previousWeekday", () => {
  it("returns Monday when given Tuesday (2026-09-15 -> 2026-09-14)", () => {
    const tuesday = dayNumber("2026-09-15");
    expect(toLocalDate(previousWeekday(tuesday))).toBe("2026-09-14");
  });

  it("returns previous Friday when given Monday (2026-09-14 -> 2026-09-11)", () => {
    const monday = dayNumber("2026-09-14");
    expect(toLocalDate(previousWeekday(monday))).toBe("2026-09-11");
  });

  it("returns Friday when given Saturday (2026-09-19 -> 2026-09-18)", () => {
    const saturday = dayNumber("2026-09-19");
    expect(toLocalDate(previousWeekday(saturday))).toBe("2026-09-18");
  });

  it("returns Friday when given Sunday (2026-09-20 -> 2026-09-18)", () => {
    const sunday = dayNumber("2026-09-20");
    expect(toLocalDate(previousWeekday(sunday))).toBe("2026-09-18");
  });
});

describe("nextWeekday", () => {
  it("returns Tuesday when given Monday (2026-09-14 -> 2026-09-15)", () => {
    const monday = dayNumber("2026-09-14");
    expect(toLocalDate(nextWeekday(monday))).toBe("2026-09-15");
  });

  it("returns next Monday when given Friday (2026-09-18 -> 2026-09-21)", () => {
    const friday = dayNumber("2026-09-18");
    expect(toLocalDate(nextWeekday(friday))).toBe("2026-09-21");
  });

  it("returns Monday when given Saturday (2026-09-19 -> 2026-09-21)", () => {
    const saturday = dayNumber("2026-09-19");
    expect(toLocalDate(nextWeekday(saturday))).toBe("2026-09-21");
  });

  it("returns Monday when given Sunday (2026-09-20 -> 2026-09-21)", () => {
    const sunday = dayNumber("2026-09-20");
    expect(toLocalDate(nextWeekday(sunday))).toBe("2026-09-21");
  });
});

describe("mondayOf", () => {
  it("maps every day Mon..Sun of the week of 2026-09-14 to 2026-09-14", () => {
    const days = [
      "2026-09-14", // Monday
      "2026-09-15", // Tuesday
      "2026-09-16", // Wednesday
      "2026-09-17", // Thursday
      "2026-09-18", // Friday
      "2026-09-19", // Saturday
      "2026-09-20", // Sunday
    ];

    for (const date of days) {
      const day = dayNumber(date);
      expect(toLocalDate(mondayOf(day))).toBe("2026-09-14");
    }
  });

  it("maps 2026-09-21 to itself", () => {
    const day = dayNumber("2026-09-21");
    expect(toLocalDate(mondayOf(day))).toBe("2026-09-21");
  });
});
