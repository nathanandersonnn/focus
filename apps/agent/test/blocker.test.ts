import { describe, expect, it } from "vitest";
import { sweep } from "../src/blocker.js";

const blocklist = { Steam: ["steam.exe", "steamwebhelper.exe"], Squad: ["squadgame.exe"] };

describe("sweep", () => {
  it("kills matching processes case-insensitively and reports one result per app", () => {
    const killed: number[] = [];
    const results = sweep(
      blocklist,
      () => [
        { pid: 1, name: "Steam.exe" },
        { pid: 2, name: "steamwebhelper.exe" },
        { pid: 3, name: "steamwebhelper.exe" },
        { pid: 4, name: "chrome.exe" },
      ],
      (pid) => {
        killed.push(pid);
        return true;
      },
    );
    expect(killed).toEqual([1, 2, 3]);
    expect(results).toEqual([{ app: "Steam", killed: true }]);
  });

  it("reports an app as not killed if any of its processes survives", () => {
    const results = sweep(
      blocklist,
      () => [
        { pid: 10, name: "SquadGame.exe" },
        { pid: 11, name: "squadgame.exe" },
      ],
      (pid) => pid !== 11,
    );
    expect(results).toEqual([{ app: "Squad", killed: false }]);
  });

  it("returns nothing when no blocked apps are running", () => {
    expect(sweep(blocklist, () => [{ pid: 1, name: "code.exe" }], () => true)).toEqual([]);
  });
});
