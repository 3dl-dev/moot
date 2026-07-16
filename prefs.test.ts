import assert from "node:assert";
import { test } from "node:test";

// Storage shim so the localStorage-persistence path runs under node.
const store = new Map<string, string>();
(globalThis as unknown as { window: object }).window = {};
(globalThis as unknown as { localStorage: object }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { getPrefs, setPref, DEFAULT_PREFS } = await import("./lib/prefs.ts");

test("defaults: compact off, freeze-pill (not live), both notif categories on", () => {
  assert.deepEqual(DEFAULT_PREFS, {
    compact: false,
    liveScroll: false,
    notifReplies: true,
    notifMentions: true,
  });
});

test("setPref updates one field and persists to localStorage", () => {
  setPref("compact", true);
  assert.equal(getPrefs().compact, true);
  assert.equal(getPrefs().liveScroll, false); // untouched
  assert.equal(JSON.parse(store.get("moot.prefs.v1")!).compact, true);
});

test("setPref leaves other fields intact", () => {
  setPref("notifMentions", false);
  const p = getPrefs();
  assert.equal(p.notifMentions, false);
  assert.equal(p.compact, true); // still set from the previous test
  assert.equal(p.notifReplies, true);
});
