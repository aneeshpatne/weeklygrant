import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hasGraphableSeries, isStableEstimate } from "../src/lib/codex-grant.js";
import { normalizeKey, stripAnsi, visibleWidth } from "../src/bin/term.js";
import {
  applyError,
  applyLatestVersion,
  applyReport,
  createState,
  handleKey,
  renderFrame,
  visibleScreen,
  withheldReason,
} from "../src/bin/tui.js";

function key(input: string) {
  if (input === "escape") return normalizeKey(undefined, { name: "escape", sequence: "\x1b" });
  if (input === "ctrl-c") return normalizeKey("\x03", { name: "c", ctrl: true, sequence: "\x03" });
  return normalizeKey(input, { name: input });
}

function report(overrides = {}) {
  return {
    algorithm: "weekly-grant-estimate-v2",
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
      { timestampMs: Date.now() - 86_400_000, valueUsd: 40, epoch: 0 },
      { timestampMs: Date.now(), valueUsd: 42, epoch: 0 },
    ],
    filesScanned: 3,
    ...overrides,
  };
}

function withConfig(run: () => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-tui-config-"));
  const previous = process.env.WEEKLYGRANT_CONFIG;
  process.env.WEEKLYGRANT_CONFIG = path.join(dir, "config.json");
  try { run(); }
  finally {
    if (previous === undefined) delete process.env.WEEKLYGRANT_CONFIG;
    else process.env.WEEKLYGRANT_CONFIG = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("loading, splash, and dashboard screens are selected from state", () => {
  assert.equal(visibleScreen(createState()), "loading");
  assert.equal(visibleScreen({ ...createState(), phase: "error", error: "boom" }), "error");

  const empty = applyReport(createState(), report({
    confidence: "none",
    validPairs: 0,
    coveragePoints: 0,
    headlineUsd: null,
    series: [],
  }));
  assert.equal(isStableEstimate(empty.report.confidence), false);
  assert.equal(hasGraphableSeries(empty.report.series), false);
  assert.equal(visibleScreen(empty), "splash");
  assert.equal(visibleScreen(applyReport(createState(), report())), "dashboard");
});

test("quit shows the thank-you screen and ready screens can rescan", () => {
  withConfig(() => {
    assert.deepEqual(handleKey(createState(), key("q")).actions, ["quit"]);
    assert.equal(handleKey(applyReport(createState(), report()), key("escape")).state.phase, "leaving");
    assert.deepEqual(handleKey(applyError(createState(), "failed"), key("ctrl-c")).actions, ["quit"]);

    const retried = handleKey(applyReport(createState(), report()), key("r"));
    assert.deepEqual(retried.actions, ["retry"]);
    assert.equal(retried.state.phase, "loading");
  });
});

test("thank-you screen supports opening and hiding the nudge", () => {
  withConfig(() => {
    const ready = applyReport(createState(), report());
    const leaving = handleKey(ready, key("q")).state;
    assert.equal(leaving.phase, "leaving");
    assert.equal(visibleScreen(leaving), "thanks");
    assert.deepEqual(handleKey(leaving, key("s")).actions, ["open-repo"]);
    assert.deepEqual(handleKey(leaving, key("n")).actions, ["hide-nudge", "quit"]);
    assert.match(stripAnsi(renderFrame(leaving, 120, 40).join("\n")), /star the repo/);
  });
});

test("an available update is shown and can launch the latest version", () => {
  const state = applyLatestVersion(applyReport(createState("1.3.1"), report()), "1.4.0");
  const frame = stripAnsi(renderFrame(state, 120, 40).join("\n"));
  assert.match(frame, /Update available: v1\.4\.0 \(running v1\.3\.1\)/);
  assert.match(frame, /npx weeklygrant@latest/);
  assert.deepEqual(handleKey(state, key("u")).actions, ["run-latest"]);
});

test("missing prices are reported when no usage or no measurement could be priced", () => {
  assert.match(
    withheldReason(report({ pricedEvents: 0, pendingEvents: 12, validPairs: 0, weeklyUsedPercent: 0 })),
    /missing prices/,
  );
  assert.match(
    withheldReason(report({ pricedEvents: 100, pendingEvents: 12, validPairs: 0, weeklyUsedPercent: 0, coveragePoints: 0 })),
    /more valid measurement/,
  );
  assert.match(
    withheldReason(report({ pricedEvents: 100, pendingEvents: 12, validPairs: 0, pricingBlockedPairs: 3, pendingModels: ["gpt-7"], weeklyUsedPercent: 42 })),
    /3 measurements were skipped for models without prices \(gpt-7\)/,
  );
});

test("small terminals show only a resize prompt", () => {
  const state = applyReport(createState(), report());
  for (const [columns, rows] of [[40, 24], [80, 20]]) {
    const lines = renderFrame(state, columns, rows);
    assert.ok(lines.every((line) => visibleWidth(line) < columns));
    const frame = stripAnsi(lines.join("\n"));
    assert.match(frame, /Expand terminal size/);
    assert.doesNotMatch(frame, /Estimated weekly API/);
  }
});

test("dashboard fits supported terminal sizes with history and update notices", () => {
  for (const confidence of ["high", "low"]) {
    for (const comparableWeeks of [0, 6]) {
      for (const latestVersion of [null, "1.4.5"]) {
        const state = applyLatestVersion(applyReport(createState("1.4.4"), report({
          confidence,
          history: { peakUsd: 100, averageUsd: 80, comparableWeeks, vsPeakPercent: -40, vsAveragePercent: -25 },
        })), latestVersion);
        for (const [columns, rows] of [[72, 28], [80, 28], [120, 30], [120, 40]]) {
          const lines = renderFrame(state, columns, rows);
          const frame = stripAnsi(lines.join("\n"));
          assert.ok(lines.length < rows, `${columns}×${rows} must leave room for redraw`);
          assert.ok(lines.every((line) => visibleWidth(line) < columns));
          assert.doesNotMatch(frame, /Expand terminal size/);
          assert.match(frame, /Estimated weekly API/);
          assert.match(frame, /\$42\.00/);
          assert.match(frame, /Estimated grant history/);
          assert.match(frame, /Observed spend/);
          assert.match(frame, /rescan/);
          if (confidence === "high" && comparableWeeks >= 2) {
            assert.match(frame, /Vs scanned peak/);
            assert.match(frame, /Vs scanned average/);
          }
          if (confidence === "low") assert.match(frame, /Early estimate/);
          if (latestVersion) assert.match(frame, /Update available/);
        }
      }
    }
  }
});

test("dashboard keeps one grant graph and historical percentage comparisons", () => {
  const state = applyReport(createState(), report({
    history: {
      peakUsd: 100,
      averageUsd: 80,
      comparableWeeks: 6,
      vsPeakPercent: -40,
      vsAveragePercent: -25,
    },
  }));
  const frame = stripAnsi(renderFrame(state, 120, 40).join("\n"));
  assert.match(frame, /Estimated weekly API/);
  assert.match(frame, /Estimated grant history/);
  assert.match(frame, /Vs scanned peak/);
  assert.match(frame, /-40%/);
  assert.match(frame, /Vs scanned average/);
  assert.match(frame, /-25%/);
  assert.doesNotMatch(frame, /Weekly quota used/);
  assert.doesNotMatch(frame, /Observed API-equivalent cost/);
});

test("dashboard marks quota resets in the remaining graph", () => {
  const state = applyReport(createState(), report({
    series: [
      { timestampMs: Date.now() - 86_400_000, valueUsd: 40, epoch: 0 },
      { timestampMs: Date.now(), valueUsd: 42, epoch: 1 },
    ],
  }));
  assert.match(stripAnsi(renderFrame(state, 120, 40).join("\n")), /···/);
});

test("an early estimate remains visible", () => {
  const state = applyReport(createState(), report({ confidence: "low", validPairs: 1, coveragePoints: 1, series: [] }));
  const frame = stripAnsi(renderFrame(state, 120, 40).join("\n"));
  assert.match(frame, /\$42\.00/);
  assert.match(frame, /Early estimate/);
});
