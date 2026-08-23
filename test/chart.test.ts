import assert from "node:assert/strict";
import test from "node:test";
import { lineChart } from "../src/lib/chart.js";

test("lineChart reports an empty range", () => {
  assert.deepEqual(lineChart([], "valueUsd", 20, 9, "$"), ["No measurements in this range"]);
});

test("lineChart draws Braille cells for a small series", () => {
  const lines = lineChart([
    { timestampMs: 1, valueUsd: 10 },
    { timestampMs: 2, valueUsd: 20 },
    { timestampMs: 3, valueUsd: 15 },
  ], "valueUsd", 20, 9, "$");
  assert.equal(lines.length, 9);
  assert.match(lines[0], /\$20\.00/);
  assert.match(lines.at(-1) || "", /\$10\.00/);
  assert.equal(lines.some((line) => /[\u2800-\u28FF]/.test(line)), true);
  assert.equal(lines.at(-1)?.includes("└"), true);
});
