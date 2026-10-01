// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { scopedDatabaseName, scopedLocalStorage } from "./browser-scope";
import { saveProfile, loadProfile } from "./storage";

describe("participant browser isolation", () => {
  const one = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", two = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const select = (id: string) => { document.documentElement.dataset.pilotMode = "true"; document.documentElement.dataset.pilotParticipant = id; };
  afterEach(() => { delete document.documentElement.dataset.pilotMode; delete document.documentElement.dataset.pilotParticipant; localStorage.clear(); });
  it("preserves the private workshop's existing storage", () => {
    saveProfile({ resume: "Private owner resume", extraInfo: "" }); expect(localStorage.getItem("art:profile")).toContain("Private owner resume");
  });
  it("switches actual profile reads and vault names between participants", () => {
    select(one); saveProfile({ resume: "Tester one", extraInfo: "" }); const first = scopedDatabaseName("vault");
    select(two); expect(loadProfile()).toBeNull(); expect(scopedDatabaseName("vault")).not.toBe(first);
    saveProfile({ resume: "Tester two", extraInfo: "" });
    select(one); expect(loadProfile()?.resume).toBe("Tester one");
    scopedLocalStorage().clear(); expect(loadProfile()).toBeNull();
    select(two); expect(loadProfile()?.resume).toBe("Tester two");
  });
  it("refuses to fall back to owner storage without a tester identity", () => {
    localStorage.setItem("art:profile", "Owner private bytes"); select("");
    expect(() => scopedLocalStorage()).toThrow(/identity/); expect(loadProfile()).toBeNull();
    expect(localStorage.getItem("art:profile")).toBe("Owner private bytes");
  });
});
