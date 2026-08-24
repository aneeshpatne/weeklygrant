import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hasGraphableSeries, isStableEstimate } from "../src/lib/codex-grant.js";
import { normalizeKey, stripAnsi } from "../src/bin/term.js";
import {
  applyReport,
  createState,
  handleKey,
  renderFrame,
  visibleScreen,
} from "../src/bin/tui.js";

function withConfig(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-tui-"));
  const previous = process.env.WEEKLYGRANT_CONFIG;
  process.env.WEEKLYGRANT_CONFIG = path.join(dir, "config.json");
  try { return run(); }
  finally {
    if (previous === undefined) delete process.env.WEEKLYGRANT_CONFIG;
    else process.env.WEEKLYGRANT_CONFIG = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function key(input: string, extra: Record<string, unknown> = {}) {
  if (input === "left" || input === "right" || input === "up" || input === "down" || input === "escape" || input === "return") {
    return normalizeKey(undefined, { name: input, ...extra });
  }
  if (input === "ctrl-c") return normalizeKey("\x03", { name: "c", ctrl: true, sequence: "\x03" });
  return normalizeKey(input, { name: input });
}

function report(overrides = {}) {
  return {
    algorithm: "weekly-grant-estimate",
    headlineUsd: 42,
    rawUsd: 40,
    confidence: "high",
    coveragePoints: 12,
    weeklyUsedPercent: 20,
    observedTokenCostUsd: 8,
    validPairs: 5,
    pricedEvents: 9,
    pendingEvents: 0,
    resetsAtMs: Date.now() + 3_600_000,
    planType: "plus",
    series: [
      { timestampMs: Date.now() - 86_400_000, valueUsd: 40, usedPercent: 10, observedCostUsd: 4 },
      { timestampMs: Date.now(), valueUsd: 42, usedPercent: 20, observedCostUsd: 8 },
    ],
    filesScanned: 3,
    pricingSources: ["official"],
    rateCardMode: "offline",
    modelUsage: [{
      model: "gpt-5.2-codex",
      uncachedInputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 50,
      totalTokens: 1250,
      apiValueUsd: 1.25,
      pricedEvents: 2,
      pendingEvents: 0,
    }],
    modelUsageSeries: [
      { timestampMs: Date.now() - 1000, model: "gpt-5.2-codex", totalTokens: 500, uncachedInputTokens: 400, cachedInputTokens: 80, outputTokens: 20, apiValueUsd: 0.5 },
      { timestampMs: Date.now(), model: "gpt-5.2-codex", totalTokens: 1250, uncachedInputTokens: 1000, cachedInputTokens: 200, outputTokens: 50, apiValueUsd: 1.25 },
    ],
    ...overrides,
  };
}

test("loading, splash, dashboard, usage, and star screens are selected from state", () => {
  assert.equal(visibleScreen(createState("estimate")), "loading");
  assert.equal(visibleScreen({ ...createState(), phase: "error", error: "boom" }), "error");
  assert.equal(visibleScreen({ ...createState(), phase: "leaving" }), "star");

  const empty = applyReport(createState("estimate"), report({
    confidence: "none",
    validPairs: 0,
    coveragePoints: 0,
    headlineUsd: null,
    series: [],
  }));
  assert.equal(isStableEstimate(empty.report.confidence), false);
  assert.equal(hasGraphableSeries(empty.report.series), false);
  assert.equal(visibleScreen(empty), "splash");

  const graphable = applyReport(createState("estimate"), report({ confidence: "low", validPairs: 1, coveragePoints: 2 }));
  assert.equal(visibleScreen(graphable), "dashboard");

  const ready = applyReport(createState("estimate"), report());
  assert.equal(visibleScreen(ready), "dashboard");

  const usage = applyReport(createState("usage"), report());
  assert.equal(visibleScreen(usage), "usage");
});

test("quit during loading skips the star nudge; quit from a ready dashboard requests it", () => {
  withConfig(() => {
    const loading = handleKey(createState("estimate"), key("q"));
    assert.deepEqual(loading.actions, ["quit"]);
    assert.equal(loading.state.phase, "loading");

    const ready = applyReport(createState("estimate"), report());
    const quit = handleKey(ready, key("escape"));
    assert.equal(quit.state.phase, "leaving");
    assert.deepEqual(quit.actions, []);

    const star = handleKey(quit.state, key("n"));
    assert.deepEqual(star.actions, ["hide-nudge", "quit"]);
    assert.deepEqual(handleKey(quit.state, key("s")).actions, ["open-repo"]);
    assert.deepEqual(handleKey(quit.state, key("ctrl-c")).actions, ["quit"]);
  });
});

test("dashboard and usage keys cycle metric, range, and model", () => {
  const dash = applyReport(createState("estimate"), report());
  assert.equal(dash.metricIndex, 0);
  assert.equal(dash.rangeIndex, 1);
  assert.equal(handleKey(dash, key("right")).state.metricIndex, 1);
  assert.equal(handleKey(dash, key("left")).state.metricIndex, 2);
  assert.equal(handleKey(dash, key("down")).state.rangeIndex, 2);
  assert.equal(handleKey(dash, key("r")).actions[0], "retry");
  assert.equal(handleKey(dash, key("r")).state.phase, "loading");

  const usage = applyReport(createState("usage"), report({
    modelUsage: [
      { model: "a", uncachedInputTokens: 1, cachedInputTokens: 0, outputTokens: 0, totalTokens: 1, apiValueUsd: 1, pricedEvents: 1, pendingEvents: 0 },
      { model: "b", uncachedInputTokens: 1, cachedInputTokens: 0, outputTokens: 0, totalTokens: 1, apiValueUsd: 0, pricedEvents: 1, pendingEvents: 0 },
    ],
  }));
  assert.equal(usage.rangeIndex, 3);
  assert.equal(handleKey(usage, key("down")).state.modelIndex, 1);
  assert.equal(handleKey(usage, key("-")).state.rangeIndex, 2);
  assert.equal(handleKey(usage, key("+")).state.rangeIndex, 3);
});

test("renderFrame prints the splash, dashboard, and usage copy", () => {
  const splash = stripAnsi(renderFrame(applyReport(createState("estimate"), report({
    confidence: "none", validPairs: 0, coveragePoints: 0, series: [], headlineUsd: null,
  })), 80).join("\n"));
  assert.match(splash, /Estimate not ready/);
  assert.match(splash, /weeklygrant/);

  const dash = stripAnsi(renderFrame(applyReport(createState("estimate"), report()), 80).join("\n"));
  assert.match(dash, /Estimated weekly API/);
  assert.match(dash, /\$42\.00/);
  assert.match(dash, /HIGH/);
  assert.match(dash, /graph/);
  assert.equal(dash.includes("╰──────────────────────╯ ╰──────────────────────╯"), true);

  const resetDash = stripAnsi(renderFrame(applyReport(createState("estimate"), report({
    series: [
      { timestampMs: Date.now() - 86_400_000, valueUsd: 40, usedPercent: 10, observedCostUsd: 4, epoch: 0, resetsAtMs: Date.now() - 3_600_000 },
      { timestampMs: Date.now(), valueUsd: 42, usedPercent: 20, observedCostUsd: 8, epoch: 1 },
    ],
  })), 80).join("\n"));
  assert.match(resetDash, /···/);

  const usage = stripAnsi(renderFrame(applyReport(createState("usage"), report()), 100).join("\n"));
  assert.match(usage, /weeklygrant usage/);
  assert.match(usage, /gpt-5\.2-codex/);
  assert.match(usage, /Total tokens/);

  const star = stripAnsi(renderFrame({ ...createState("estimate"), phase: "leaving", spinner: 0 }, 80).join("\n"));
  const starNext = stripAnsi(renderFrame({ ...createState("estimate"), phase: "leaving", spinner: 5 }, 80).join("\n"));
  assert.match(star, /thank you/);
  assert.match(star, /star the repo/);
  assert.match(star, /[·.*oO@]/);
  assert.notEqual(star, starNext);
});
