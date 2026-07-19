import assert from "node:assert";
import { test } from "node:test";
import {
  rrfWeight,
  mergeSources,
  exploreScore,
  rankExplore,
  RRF_K,
  type ExploreCandidate,
} from "./lib/explore.ts";

test("rrfWeight decreases with rank and clamps negatives to rank 0", () => {
  assert.equal(rrfWeight(0), 1 / RRF_K);
  assert.ok(rrfWeight(0) > rrfWeight(1));
  assert.ok(rrfWeight(1) > rrfWeight(10));
  assert.equal(rrfWeight(-5), rrfWeight(0)); // negative clamps
});

test("mergeSources dedupes and sums fusion across feeds", () => {
  const merged = mergeSources([
    { tag: "hot", ids: ["a", "b", "c"] },
    { tag: "top", ids: ["b", "d"] },
  ]);
  const b = merged.find((c) => c.id === "b")!;
  // b is rank 1 in hot + rank 0 in top
  assert.deepEqual(b.sources.sort(), ["hot", "top"]);
  assert.ok(Math.abs(b.fusion - (rrfWeight(1) + rrfWeight(0))) < 1e-12);
  // every id present exactly once
  assert.equal(merged.length, 4);
  assert.equal(new Set(merged.map((c) => c.id)).size, 4);
});

test("mergeSources: cross-feed agreement outranks a lone top slot", () => {
  // 'x' is #0 in one feed only; 'y' is #1 in two feeds.
  const merged = mergeSources([
    { tag: "f1", ids: ["x", "y"] },
    { tag: "f2", ids: ["z", "y"] },
  ]);
  assert.equal(merged[0].id, "y"); // agreement wins over a single #0
});

test("mergeSources does not double-count a repeated source tag", () => {
  const merged = mergeSources([{ tag: "hot", ids: ["a", "a"] }]);
  // duplicate within one source keeps a single sources entry (fusion still sums,
  // but the source is listed once — real feeds are deduped upstream)
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ["hot"]);
});

test("exploreScore rewards engagement with diminishing returns", () => {
  const base = exploreScore(1, 0, 0);
  const some = exploreScore(1, 10, 0);
  const lots = exploreScore(1, 100, 0);
  assert.ok(some > base);
  assert.ok(lots > some);
  // log1p ⇒ 10x the engagement is far less than 10x the boost
  assert.ok(lots - some < some - base + base); // sublinear
});

test("exploreScore decays gently with age but engagement can overcome it", () => {
  const freshLow = exploreScore(1, 0, 0);
  const oldLow = exploreScore(1, 0, 48 * 3600); // 2 days old
  assert.ok(freshLow > oldLow); // freshness matters…
  const oldHigh = exploreScore(1, 200, 48 * 3600);
  assert.ok(oldHigh > freshLow); // …but real engagement beats mere newness
});

test("rankExplore blends fusion with engagement, not raw recency", () => {
  const candidates: ExploreCandidate[] = [
    { id: "fresh-empty", sources: ["hot"], fusion: rrfWeight(0) },
    { id: "older-hot", sources: ["hot", "top"], fusion: rrfWeight(0) + rrfWeight(0) },
  ];
  const now = 1_000_000;
  const meta: Record<string, { engagement: number; createdAt: number }> = {
    "fresh-empty": { engagement: 0, createdAt: now }, // brand new, no engagement
    "older-hot": { engagement: 80, createdAt: now - 6 * 3600 }, // 6h old, well-engaged
  };
  const ranked = rankExplore(candidates, now, (id) => meta[id]);
  assert.equal(ranked[0].id, "older-hot"); // recency alone does not win
});

test("rankExplore falls back to fusion order for ids with no metadata", () => {
  const candidates: ExploreCandidate[] = [
    { id: "a", sources: ["hot"], fusion: 0.5 },
    { id: "b", sources: ["hot"], fusion: 0.9 },
  ];
  const ranked = rankExplore(candidates, 1000, () => undefined);
  assert.deepEqual(
    ranked.map((c) => c.id),
    ["b", "a"]
  );
});
