import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateGrantFromLogs,
  loadRateCards,
  priceTokens,
  splitEpochs,
  summarizeModelUsage,
  weightedMedian,
} from "../src/lib/codex-grant.js";

function observation(timestampMs, usedPercent, resetsAtMs = 100_000) {
  return { timestampMs, usedPercent, resetsAtMs, limitId: "codex", accountKey: "local" };
}

function pricedEvent(timestampMs, costUsd) {
  return { timestampMs, costUsd, eligible: true, quotaLimitId: "codex" };
}

test("prices 420k gpt-5.2-codex input tokens at $0.735", () => {
  const result = priceTokens({
    model: "gpt-5.2-codex",
    uncachedInput: 420_000,
    cachedInput: 0,
    billedOutput: 0,
    serviceTier: "standard",
  });
  assert.equal(result.costUsd, 0.735);
  assert.equal(result.eligible, true);
});

test("infers a $42 week from $0.42 over one quota point", () => {
  const result = estimateGrantFromLogs(
    [pricedEvent(1_500, 0.42)],
    [observation(1_000, 0), observation(2_000, 1)],
  );
  assert.equal(result.rawUsd, 42);
  assert.equal(result.headlineUsd, 42);
  assert.equal(result.confidence, "low");
});

test("weighted median lets a wider quota move beat outliers", () => {
  assert.equal(weightedMedian([
    { value: 40, weight: 1 },
    { value: 95, weight: 6 },
    { value: 400, weight: 1 },
  ]), 95);
});

test("small downward jitter is clamped without starting a new epoch", () => {
  const epochs = splitEpochs([
    observation(1_000, 10),
    observation(2_000, 14),
    observation(3_000, 11, 99_000),
    observation(4_000, 16),
  ]);
  assert.equal(epochs.length, 1);
  assert.deepEqual(epochs[0].map((item) => item.usedPercent), [10, 14, 14, 16]);
});

test("a genuine reset starts a new epoch", () => {
  const epochs = splitEpochs([
    observation(1_000, 80, 3_000),
    observation(2_000, 84, 3_000),
    observation(4_000, 6, 20_000),
    observation(5_000, 8, 20_000),
  ]);
  assert.equal(epochs.length, 2);
  assert.deepEqual(epochs.map((epoch) => epoch.map((item) => item.usedPercent)), [[80, 84], [6, 8]]);
});

test("an unmatched usage jump does not collapse the estimate", () => {
  const result = estimateGrantFromLogs(
    [pricedEvent(1_500, 1), pricedEvent(3_500, 1)],
    [
      observation(1_000, 10),
      observation(2_000, 11),
      observation(3_000, 40),
      observation(4_000, 41),
    ],
  );
  assert.equal(result.validPairs, 2);
  assert.equal(result.headlineUsd, 100);
});

test("a new epoch does not inherit confidence from the previous epoch", () => {
  const result = estimateGrantFromLogs(
    [
      pricedEvent(1_500, 1),
      pricedEvent(2_500, 1),
      pricedEvent(3_500, 1),
      pricedEvent(4_500, 1),
      pricedEvent(5_500, 1),
      pricedEvent(12_500, 20),
    ],
    [
      observation(1_000, 75, 10_000),
      observation(2_000, 76, 10_000),
      observation(3_000, 77, 10_000),
      observation(4_000, 78, 10_000),
      observation(5_000, 79, 10_000),
      observation(6_000, 80, 10_000),
      observation(12_000, 0, 200_000),
      observation(13_000, 20, 200_000),
    ],
  );
  assert.equal(result.validPairs, 1);
  assert.equal(result.confidence, "low");
});

test("a new epoch does not graph a stale estimate as a heartbeat", () => {
  const result = estimateGrantFromLogs(
    [pricedEvent(1_500, 0.42)],
    [
      observation(1_000, 80, 10_000),
      observation(2_000, 81, 10_000),
      observation(12_000, 5, 200_000),
      observation(13_000, 6, 200_000),
    ],
  );
  assert.equal(result.headlineUsd, null);
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].epoch, 0);
});

test("offline rate-card loading uses bundled official prices", async () => {
  const cards = await loadRateCards(null);
  assert.equal(cards["gpt-5.6-terra"].source, "official");
  assert.equal(cards["gpt-5.6-terra"].input, 2);
});

test("summarizes token usage and API value by model", () => {
  const result = summarizeModelUsage([
    { model: "gpt-5.2-codex", uncachedInput: 100, cachedInput: 50, billedOutput: 25, eligible: true, costUsd: 0.01 },
    { model: "gpt-5.2-codex", uncachedInput: 200, cachedInput: 0, billedOutput: 10, eligible: true, costUsd: 0.02 },
    { model: "future-model", uncachedInput: 5, cachedInput: 0, billedOutput: 1, eligible: false, costUsd: 0 },
  ]);
  assert.deepEqual(result, [
    {
      model: "gpt-5.2-codex",
      uncachedInputTokens: 300,
      cachedInputTokens: 50,
      outputTokens: 35,
      totalTokens: 385,
      apiValueUsd: 0.03,
      pricedEvents: 2,
      pendingEvents: 0,
    },
    {
      model: "future-model",
      uncachedInputTokens: 5,
      cachedInputTokens: 0,
      outputTokens: 1,
      totalTokens: 6,
      apiValueUsd: 0,
      pricedEvents: 0,
      pendingEvents: 1,
    },
  ]);
});
