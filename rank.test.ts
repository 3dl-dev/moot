import assert from "node:assert";
import { test } from "node:test";
import {
  weightedEngagement,
  hotScore,
  topScore,
  risingScore,
  controversyScore,
  engagementVelocity,
  netReactions,
  rankPosts,
  trustWeight,
  authorPrior,
  SCORERS,
  RISING_MAX_AGE_HOURS,
  WEIGHTS,
  TRUST_WEIGHT,
  AUTHOR_PRIOR,
  ZERO_SIGNALS,
  type RankSignals,
  type TrustTier,
} from "./lib/rank.ts";

const sig = (s: Partial<RankSignals>): RankSignals => ({ ...ZERO_SIGNALS, ...s });
const HOUR = 3600;

// --- weightedEngagement: the discussion-first objective ---------------------

test("a distinct replier is worth more than a single reaction", () => {
  // The whole thesis: joining the conversation beats a silent tap.
  assert.ok(WEIGHTS.replier > WEIGHTS.reaction);
  assert.ok(weightedEngagement(sig({ repliers: 1 })) > weightedEngagement(sig({ upvotes: 1 })));
});

test("weightedEngagement is monotonic in every signal", () => {
  const base = weightedEngagement(ZERO_SIGNALS);
  assert.ok(weightedEngagement(sig({ upvotes: 1 })) > base);
  assert.ok(weightedEngagement(sig({ sats: 100 })) > base);
  assert.ok(weightedEngagement(sig({ repliers: 1 })) > base);
  assert.ok(weightedEngagement(sig({ replies: 5, repliers: 1 })) > weightedEngagement(sig({ repliers: 1 })));
});

test("extra replies credit depth without double-counting repliers", () => {
  // 3 repliers who each said one thing vs. 3 repliers with a deep back-and-forth.
  const shallow = weightedEngagement(sig({ repliers: 3, replies: 3 }));
  const deep = weightedEngagement(sig({ repliers: 3, replies: 12 }));
  assert.ok(deep > shallow);
  // The depth credit is the reply weight, not another full replier weight.
  assert.equal(deep - shallow, WEIGHTS.reply * 9);
});

test("a net-downvoted post never scores negative", () => {
  assert.equal(weightedEngagement(sig({ downvotes: 50 })), 0);
  // ...and the decayed score stays positive (decay can't flip sign).
  assert.ok(hotScore(sig({ downvotes: 50 }), 10 * HOUR) > 0);
});

test("downvotes cancel upvotes in weighted engagement (burying works)", () => {
  assert.ok(weightedEngagement(sig({ upvotes: 10 })) > weightedEngagement(sig({ upvotes: 10, downvotes: 8 })));
  assert.equal(netReactions(sig({ upvotes: 10, downvotes: 3 })), 7);
});

// --- hotScore: freshness decay ---------------------------------------------

test("fresh zero-engagement post scores above zero (visible, not buried)", () => {
  assert.ok(hotScore(ZERO_SIGNALS, 0) > 0);
});

test("older post decays below an identical fresher one", () => {
  const s = sig({ repliers: 5, sats: 500 });
  assert.ok(hotScore(s, 1 * HOUR) > hotScore(s, 12 * HOUR));
});

test("real trusted discussion outranks a newer empty post", () => {
  const discussed = hotScore(sig({ repliers: 20, replies: 60, sats: 2000 }), 6 * HOUR);
  const freshEmpty = hotScore(ZERO_SIGNALS, 5 * 60); // 5 minutes old
  assert.ok(discussed > freshEmpty);
});

test("but sheer newness beats a trickle of old engagement (feed stays fresh)", () => {
  const staleTrickle = hotScore(sig({ upvotes: 3 }), 48 * HOUR);
  const freshEmpty = hotScore(ZERO_SIGNALS, 2 * 60);
  assert.ok(freshEmpty > staleTrickle);
});

// --- web of trust: score the messenger -------------------------------------

test("trust weight is core > extended > unknown, and unknown by default", () => {
  const tiers = new Map<string, TrustTier>([
    ["core-pk", "core"],
    ["ext-pk", "extended"],
  ]);
  assert.equal(trustWeight("core-pk", tiers), TRUST_WEIGHT.core);
  assert.equal(trustWeight("ext-pk", tiers), TRUST_WEIGHT.extended);
  assert.equal(trustWeight("stranger-pk", tiers), TRUST_WEIGHT.unknown);
  assert.ok(TRUST_WEIGHT.core > TRUST_WEIGHT.extended);
  assert.ok(TRUST_WEIGHT.extended > TRUST_WEIGHT.unknown);
});

test("a botnet of strangers can't out-signal one trusted human", () => {
  // 100 unknown likes (already trust-weighted by the collector) vs. 3 core repliers.
  const botnet = sig({ upvotes: 100 * TRUST_WEIGHT.unknown });
  const humans = sig({ repliers: 3 * TRUST_WEIGHT.core });
  assert.ok(weightedEngagement(humans) > weightedEngagement(botnet));
});

// --- author prior: fresh spam from strangers stays buried ------------------

test("author prior lifts a trusted author's fresh post above a stranger's", () => {
  // Both brand-new, zero engagement — only the author's trust separates them.
  const trusted = hotScore(ZERO_SIGNALS, 5 * 60, AUTHOR_PRIOR.core);
  const stranger = hotScore(ZERO_SIGNALS, 5 * 60, AUTHOR_PRIOR.unknown);
  assert.ok(trusted > stranger);
});

test("author prior defaults to 0 (unknown) and is looked up by tier", () => {
  const tiers = new Map<string, TrustTier>([["core-pk", "core"]]);
  assert.equal(authorPrior("core-pk", tiers), AUTHOR_PRIOR.core);
  assert.equal(authorPrior("stranger-pk", tiers), 0);
  // Prior never drags a score down, even if negative is passed.
  assert.equal(hotScore(ZERO_SIGNALS, 0, -5), hotScore(ZERO_SIGNALS, 0, 0));
});

test("engagement still beats the prior — strangers can earn their way up", () => {
  // A stranger's post with real trusted discussion outranks a bare core post.
  const strangerDiscussed = hotScore(sig({ repliers: 4, sats: 300 }), 1 * HOUR, AUTHOR_PRIOR.unknown);
  const coreBare = hotScore(ZERO_SIGNALS, 1 * HOUR, AUTHOR_PRIOR.core);
  assert.ok(strangerDiscussed > coreBare);
});

// --- the five sorts --------------------------------------------------------

test("TOP ignores age — best-of-window rises regardless of freshness", () => {
  const loud = sig({ repliers: 10, sats: 500 });
  const quiet = sig({ upvotes: 1 });
  assert.ok(topScore(loud) > topScore(quiet));
  // Same signals at any age score identically under Top (no decay).
  const now = 1_000_000;
  const ranked = rankPosts(
    [
      { id: "old-loud", signals: loud, createdAt: now - 40 * HOUR },
      { id: "new-quiet", signals: quiet, createdAt: now - 60 },
    ],
    now,
    SCORERS.top
  );
  assert.equal(ranked[0].id, "old-loud");
});

test("RISING rewards velocity and ignores posts past the age gate", () => {
  const s = sig({ repliers: 4, sats: 200 });
  // Same engagement, younger post is 'rising' harder.
  assert.ok(risingScore(s, 20 * 60) > risingScore(s, 2 * HOUR));
  // Past the gate: not rising, whatever the engagement.
  assert.equal(risingScore(s, (RISING_MAX_AGE_HOURS + 1) * HOUR), 0);
  // No engagement is not "rising", just new.
  assert.equal(risingScore(ZERO_SIGNALS, 10 * 60), 0);
});

test("CONTROVERSIAL: 'the ratio' — argument without endorsement scores high", () => {
  assert.equal(controversyScore(sig({ upvotes: 100 })), 0); // all love, no argument
  assert.equal(controversyScore(ZERO_SIGNALS), 0);
  const ratioed = controversyScore(sig({ replies: 40, upvotes: 2 })); // dunked on
  const beloved = controversyScore(sig({ replies: 2, upvotes: 40 })); // liked, not argued
  assert.ok(ratioed > beloved);
});

test("CONTROVERSIAL: more argument at equal likes ⇒ more controversial", () => {
  const calm = controversyScore(sig({ upvotes: 10, replies: 5 }));
  const heated = controversyScore(sig({ upvotes: 10, replies: 40 }));
  assert.ok(heated > calm);
});

test("CONTROVERSIAL: downvotes fold into pushback (dissent-aware as they appear)", () => {
  const base = controversyScore(sig({ replies: 10, upvotes: 5 }));
  const withDown = controversyScore(sig({ replies: 10, upvotes: 5, downvotes: 10 }));
  assert.ok(withDown > base); // real dissent strengthens the ratio, no code switch
});

test("CONTROVERSIAL: a well-liked, well-discussed post is popular, NOT controversial", () => {
  // The real bug: a post with lots of replies but even more likes was topping
  // Controversial (and Hot/Top). Pushback must EXCEED endorsement to qualify.
  assert.equal(controversyScore(sig({ replies: 7, upvotes: 9, sats: 149 })), 0);
  assert.ok(controversyScore(sig({ replies: 12, upvotes: 3 })) > 0); // genuinely ratio'd
});

test("RISING real velocity: Δengagement per hour, never negative", () => {
  const prev = sig({ upvotes: 2 });
  const curr = sig({ upvotes: 2, repliers: 3, replies: 3 });
  const v = engagementVelocity(prev, curr, 30 * 60); // +3 repliers over 30 min
  assert.ok(v > 0);
  assert.ok(engagementVelocity(prev, curr, 60 * 60) < v); // same gain, twice the time ⇒ slower
  assert.equal(engagementVelocity(curr, prev, 30 * 60), 0); // engagement dropping ⇏ rising
});

// --- rankPosts: end-to-end ordering ----------------------------------------

test("rankPosts orders by hot score, freshest breaks ties", () => {
  const now = 1_000_000;
  const ranked = rankPosts(
    [
      { id: "cold", signals: ZERO_SIGNALS, createdAt: now - 30 * HOUR },
      { id: "hot", signals: sig({ repliers: 15, sats: 1000 }), createdAt: now - 3 * HOUR },
      { id: "fresh", signals: ZERO_SIGNALS, createdAt: now - 60 },
    ],
    now
  );
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["hot", "fresh", "cold"]
  );
});
