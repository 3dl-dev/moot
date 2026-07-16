import assert from "node:assert";
import { test } from "node:test";

// Minimal browser-storage shim so the localStorage-guarded logic actually runs
// under node (drafts.ts no-ops when `window` is undefined).
const store = new Map<string, string>();
(globalThis as unknown as { window: object }).window = {};
(globalThis as unknown as { localStorage: object }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { getDraft, saveDraft, clearDraft } = await import("./lib/drafts.ts");

test("saveDraft persists text and getDraft restores it", () => {
  saveDraft("reply:abc", "hello world");
  assert.equal(getDraft("reply:abc"), "hello world");
});

test("saving blank text removes the draft (a sent/emptied composer leaves nothing)", () => {
  saveDraft("reply:x", "draft");
  assert.equal(getDraft("reply:x"), "draft");
  saveDraft("reply:x", "   "); // whitespace-only counts as empty
  assert.equal(getDraft("reply:x"), "");
});

test("clearDraft removes the entry", () => {
  saveDraft("k", "v");
  clearDraft("k");
  assert.equal(getDraft("k"), "");
});

test("an empty key is a no-op (never writes a stray entry)", () => {
  saveDraft("", "x");
  assert.equal(getDraft(""), "");
});
