import assert from "node:assert";
import { test } from "node:test";
import {
  addBookmark,
  bookmarkSuperset,
  buildBookmarkTags,
  clearBookmarks,
  getBookmarks,
  isBookmarked,
  isManagedBookmarkTag,
  mergeBookmarks,
  parseBookmarkTags,
  removeBookmark,
  toggleBookmark,
} from "./lib/bookmarks.ts";

test("parseBookmarkTags reads `e` note ids and ignores other bookmark kinds", () => {
  const tags = [
    ["e", "note1"],
    ["a", "30023:pk:slug"], // article bookmark — another client's
    ["t", "nostr"], // hashtag bookmark
    ["r", "https://example.com"], // url bookmark
    ["e", "note2"],
    ["e"], // malformed — no id
  ];
  assert.deepEqual(parseBookmarkTags(tags), ["note1", "note2"]);
});

test("isManagedBookmarkTag marks only `e` (note) tags", () => {
  assert.equal(isManagedBookmarkTag(["e", "x"]), true);
  for (const k of ["a", "t", "r", "p"]) assert.equal(isManagedBookmarkTag([k, "x"]), false);
});

test("buildBookmarkTags rebuilds managed `e` tags and preserves everything else", () => {
  const preserved = [
    ["e", "STALE"], // a managed tag from the old event — must be dropped, rebuilt from ids
    ["a", "30023:pk:slug"], // preserve: article bookmark
    ["t", "nostr"], // preserve: hashtag bookmark
    ["r", "https://example.com"], // preserve: url bookmark
  ];
  assert.deepEqual(buildBookmarkTags(["note1", "note2"], preserved), [
    ["e", "note1"],
    ["e", "note2"],
    ["a", "30023:pk:slug"],
    ["t", "nostr"],
    ["r", "https://example.com"],
  ]);
});

test("mergeBookmarks unions de-duplicated, local (newest) first", () => {
  assert.deepEqual(mergeBookmarks(["b", "a"], ["a", "c"]), ["b", "a", "c"]);
});

test("bookmarkSuperset is true only when the remote already has every local id", () => {
  assert.equal(bookmarkSuperset(["a", "b", "c"], ["a", "b"]), true);
  assert.equal(bookmarkSuperset(["a"], ["a", "b"]), false);
  assert.equal(bookmarkSuperset([], []), true);
});

test("store: add / toggle / remove roundtrip, newest-first", () => {
  clearBookmarks();
  assert.deepEqual(getBookmarks(), []);
  addBookmark("n1");
  addBookmark("n2");
  assert.deepEqual(getBookmarks(), ["n2", "n1"]); // newest first
  assert.equal(isBookmarked("n1"), true);
  addBookmark("n1"); // idempotent — no duplicate
  assert.deepEqual(getBookmarks(), ["n2", "n1"]);
  toggleBookmark("n2"); // off
  assert.equal(isBookmarked("n2"), false);
  toggleBookmark("n3"); // on
  assert.deepEqual(getBookmarks(), ["n3", "n1"]);
  removeBookmark("n1");
  assert.deepEqual(getBookmarks(), ["n3"]);
  clearBookmarks();
});
