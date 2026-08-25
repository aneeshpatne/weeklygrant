import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bucketSeries,
  buildCostLanes,
  buildModelUsageSeries,
  costInWindow,
  estimateCodexGrant,
  estimateGrantFromLogs,
  hasGraphableSeries,
  isStableEstimate,
  loadRateCards,
  parseLogFile,
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
  assert.equal(result.matchedCoveragePoints, 2);
  assert.equal(result.coveragePoints, 31);
});

test("headline pools robust inliers and rejects a divergent slice", () => {
  const events: any[] = [];
  const observations = [observation(1_000, 0)];
  for (let index = 1; index <= 8; index++) {
    events.push(pricedEvent(1_000 + index * 1_000 - 500, 0.5));
    observations.push(observation(1_000 + index * 1_000, index * 0.5));
  }
  events.push(pricedEvent(9_500, 6));
  observations.push(observation(10_000, 8));
  const result = estimateGrantFromLogs(events, observations);
  assert.equal(result.headlineUsd, 100);
  assert.equal(result.rawUsd, 100);
  assert.equal(result.matchedCoveragePoints, 4);
  assert.equal(result.outlierPairs, 1);
  assert.equal(result.series.filter((point) => point.kind === "quote").at(-1).valueUsd, 100);
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

test("two early quotes are graphable while the headline stays unready", () => {
  const result = estimateGrantFromLogs(
    [pricedEvent(1_500, 0.42), pricedEvent(3_500, 0.42)],
    [
      observation(1_000, 0),
      observation(2_000, 1),
      observation(4_000, 2),
    ],
  );
  assert.equal(result.confidence, "low");
  assert.equal(result.validPairs, 2);
  assert.equal(result.coveragePoints, 2);
  assert.equal(isStableEstimate(result.confidence), false);
  assert.equal(hasGraphableSeries(result.series), true);
});

test("a single quote is not graphable", () => {
  const result = estimateGrantFromLogs(
    [pricedEvent(1_500, 0.42)],
    [observation(1_000, 0), observation(2_000, 1)],
  );
  assert.equal(hasGraphableSeries(result.series), false);
  assert.equal(hasGraphableSeries([]), false);
  assert.equal(isStableEstimate("medium"), true);
  assert.equal(isStableEstimate("high"), true);
  assert.equal(isStableEstimate("low"), false);
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

test("official GPT-5.6 Sol pricing includes long context and Codex Fast mode", () => {
  const base = { model: "gpt-5.6-sol", uncachedInput: 1_000_000, cachedInput: 1_000_000, billedOutput: 1_000_000 };
  assert.equal(priceTokens({ ...base, serviceTier: "standard", requestInputTokens: 2_000_000 }).costUsd, 38.8);
  assert.equal(priceTokens({ ...base, serviceTier: "fast", requestInputTokens: 1 }).costUsd, 61);
});

test("price refresh fills unknown cards without overriding bundled official cards", async () => {
  const cards = await loadRateCards(async () => ({
    ok: true,
    json: async () => ({ openai: { models: {
      "gpt-5.6-sol": { cost: { input: 999, output: 999, cache_read: 999 } },
      "future-model": { cost: { input: 3, output: 9, cache_read: 0.3 } },
    } } }),
  }) as Response);
  assert.equal(cards["gpt-5.6-sol"].input, 4);
  assert.equal(cards["future-model"].input, 3);
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

test("builds cumulative per-model usage series", () => {
  const result = buildModelUsageSeries([
    { timestampMs: 2_000, model: "gpt-5.2-codex", uncachedInput: 20, cachedInput: 5, billedOutput: 2, eligible: true, costUsd: 0.02 },
    { timestampMs: 1_000, model: "gpt-5.2-codex", uncachedInput: 10, cachedInput: 3, billedOutput: 1, eligible: true, costUsd: 0.01 },
  ]);
  assert.deepEqual(result.map(({ timestampMs, totalTokens, apiValueUsd }) => ({ timestampMs, totalTokens, apiValueUsd })), [
    { timestampMs: 1_000, totalTokens: 14, apiValueUsd: 0.01 },
    { timestampMs: 2_000, totalTokens: 41, apiValueUsd: 0.03 },
  ]);
});

test("cost windows use prefix sums and ignore other quota ids", () => {
  const lanes = buildCostLanes([
    { timestampMs: 1_000, costUsd: 1, eligible: true, quotaLimitId: "codex" },
    { timestampMs: 2_000, costUsd: 2, eligible: true, quotaLimitId: "other" },
    { timestampMs: 3_000, costUsd: 4, eligible: true, quotaLimitId: null },
    { timestampMs: 4_000, costUsd: 8, eligible: true, quotaLimitId: "codex" },
  ]);
  assert.equal(costInWindow(lanes, 1_000, 4_000, "codex"), 8);
  assert.equal(costInWindow(lanes, 1_000, 3_000, "codex"), 0);
  assert.equal(costInWindow(lanes, 0, 4_000, "other"), 2);
});

test("events on another quota id do not inflate the weekly fit", () => {
  const result = estimateGrantFromLogs(
    [
      { timestampMs: 1_500, costUsd: 0.42, eligible: true, quotaLimitId: "codex" },
      { timestampMs: 1_600, costUsd: 50, eligible: true, quotaLimitId: "other" },
    ],
    [observation(1_000, 0), observation(2_000, 1)],
  );
  assert.equal(result.rawUsd, 42);
});

test("bucketSeries keeps the last point in each time bucket", () => {
  const points = Array.from({ length: 20 }, (_, index) => ({ timestampMs: index, value: index }));
  const result = bucketSeries(points, 4);
  assert.equal(result.length, 4);
  assert.equal(result[0].timestampMs, 4);
  assert.equal(result.at(-1).timestampMs, 19);
});

test("estimate series is bucketed when the history is long", () => {
  const events = [{ timestampMs: 1_500, costUsd: 0.5, eligible: true, quotaLimitId: "codex" }];
  const observations = [
    observation(1_000, 0),
    observation(2_000, 1),
    ...Array.from({ length: 2_000 }, (_, index) => observation(3_000 + index, 1 + index * 0.0001)),
  ];
  const result = estimateGrantFromLogs(events, observations);
  assert.equal(result.validPairs, 1);
  assert.equal(result.series.length <= 1_000, true);
  assert.equal(result.series.length >= 2, true);
});

test("buildModelUsageSeries caps each model to maxPoints", () => {
  const events = Array.from({ length: 50 }, (_, index) => ({
    timestampMs: index,
    model: "gpt-5.2-codex",
    uncachedInput: 1,
    cachedInput: 0,
    billedOutput: 0,
    eligible: true,
    costUsd: 0.01,
  }));
  const result = buildModelUsageSeries(events, 10);
  assert.equal(result.length, 10);
  assert.equal(result.at(-1).totalTokens, 50);
});

test("parseLogFile uses the provided mtime fallback and reads token deltas", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-jsonl-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.2-codex" } }),
    JSON.stringify({
      type: "token_count",
      payload: {
        info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 5 } },
        rate_limits: { limit_id: "codex", primary: { window_minutes: 10_080, used_percent: 1, resets_at: 200_000 } },
      },
    }),
    "",
  ].join("\n"));
  const parsed = parseLogFile(file, 50_000, fs.statSync(file).size);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].timestampMs, 50_000);
  assert.equal(parsed.events[0].uncachedInput, 80);
  assert.equal(parsed.observations.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseLogFile streams a file larger than 256 KiB and survives a line that spans chunks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-stream-"));
  const file = path.join(dir, "session.jsonl");
  const token = (input) => JSON.stringify({
    type: "token_count",
    timestamp: 1_000,
    payload: { info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 1 } } },
  });
  const noise = JSON.stringify({ type: "noise", blob: "x".repeat(80_000) });
  const filler = Array.from({ length: 2_000 }, () => noise);
  fs.writeFileSync(file, [JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.2-codex" } }), token(10), ...filler, token(25)].join("\n"));
  assert.equal(fs.statSync(file).size > 256 * 1024, true);
  const parsed = parseLogFile(file);
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.events[0].uncachedInput, 10);
  assert.equal(parsed.events[1].uncachedInput, 15);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseLogFile skips conversation payloads and reads event_msg token counts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-skip-"));
  const file = path.join(dir, "session.jsonl");
  const token = (input) => JSON.stringify({
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 1 } },
    },
  });
  const discarded = JSON.stringify({ type: "response_item", payload: { blob: "x".repeat(1_500_000) } });
  fs.writeFileSync(file, [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.2-codex" } }),
    token(10),
    discarded,
    JSON.stringify({ type: "event_msg", payload: { type: "item_completed", blob: "y".repeat(8_000) } }),
    token(25),
  ].join("\n"));
  const parsed = parseLogFile(file);
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.events[0].uncachedInput, 10);
  assert.equal(parsed.events[1].uncachedInput, 15);
  assert.equal(parsed.events[0].model, "gpt-5.2-codex");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseLogFile keeps a session_meta line that spans read chunks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-keep-span-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "session_meta", payload: { id: "span-session", blob: "z".repeat(1_200_000) } }),
    JSON.stringify({
      type: "token_count",
      timestamp: 1_000,
      payload: { info: { total_token_usage: { input_tokens: 4, cached_input_tokens: 0, output_tokens: 1 } } },
    }),
  ].join("\n"));
  const parsed = parseLogFile(file);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].sessionId, "span-session");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseLogFile accepts CRLF and spaced type keys", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-crlf-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, [
    '{ "type" : "turn_context", "payload": { "model": "gpt-5.2-codex" } }',
    '{ "type" : "token_count", "timestamp": 1000, "payload": { "info": { "total_token_usage": { "input_tokens": 10, "cached_input_tokens": 0, "output_tokens": 1 } } } }',
  ].join("\r\n"));
  const parsed = parseLogFile(file, 50_000);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].uncachedInput, 10);
  assert.equal(parsed.events[0].model, "gpt-5.2-codex");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseLogFile ignores repeated totals and recovers a reset from last usage", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-counter-reset-"));
  const file = path.join(dir, "session.jsonl");
  const token = (total) => JSON.stringify({
    type: "event_msg",
    timestamp: 1_000 + total,
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0 },
        last_token_usage: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0 },
      },
    },
  });
  fs.writeFileSync(file, [token(100), token(100), token(50)].join("\n"));
  const parsed = parseLogFile(file);
  assert.deepEqual(parsed.events.map((event) => event.uncachedInput), [100, 50]);
  assert.deepEqual(parsed.events.map((event) => event.counterReset), [false, true]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a scheduled weekly reset splits low and zero usage epochs", () => {
  const week = 7 * 86_400_000;
  const resetsAt = 10_000;
  const epochs = splitEpochs([
    observation(1_000, 1, resetsAt),
    observation(resetsAt + 1, 0, resetsAt + week),
    observation(resetsAt + 2, 0, resetsAt + week),
  ]);
  assert.deepEqual(epochs.map((epoch) => epoch.map((item) => item.usedPercent)), [[1], [0, 0]]);
});

test("estimateCodexGrant skips usage series unless requested", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-home-"));
  fs.mkdirSync(path.join(root, "sessions"));
  const file = path.join(root, "sessions", "session.jsonl");
  fs.writeFileSync(file, `${JSON.stringify({
    type: "token_count",
    timestamp: 1_000,
    payload: { info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 } } },
  })}\n`);
  const skipped = await estimateCodexGrant({ home: root });
  const included = await estimateCodexGrant({ home: root, includeUsageSeries: true });
  assert.deepEqual(skipped.modelUsage, []);
  assert.deepEqual(skipped.modelUsageSeries, []);
  assert.equal(included.modelUsage.length, 1);
  assert.equal(included.modelUsageSeries.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
