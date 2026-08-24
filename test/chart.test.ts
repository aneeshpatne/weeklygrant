import assert from "node:assert/strict";
import test from "node:test";
import { lineChart, RESET_MARK } from "../src/lib/chart.js";

test("lineChart reports an empty range", () => {
  assert.deepEqual(lineChart([], "valueUsd", 20, 9, "$"), ["No measurements in this range"]);
});

function graphCells(line: string) {
  const index = Math.max(line.lastIndexOf("│"), line.lastIndexOf("└"));
  return index >= 0 ? line.slice(index + 1) : line;
}

function lastInk(line: string) {
  const cells = [...graphCells(line)];
  return cells.findLastIndex((cell) => /[\u2800-\u28FF]/.test(cell));
}

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

test("lineChart places points by timestamp, not by sample index", () => {
  const lines = lineChart([
    { timestampMs: 0, valueUsd: 10 },
    { timestampMs: 1, valueUsd: 10 },
    { timestampMs: 2, valueUsd: 10 },
    { timestampMs: 100, valueUsd: 50 },
  ], "valueUsd", 24, 9, "$");
  const low = lastInk(lines.at(-1) || "");
  const high = [...graphCells(lines[0])].findIndex((cell) => /[\u2800-\u28FF]/.test(cell));
  assert.equal(low >= 0, true);
  assert.equal(high >= 0, true);
  assert.equal(low < graphCells(lines.at(-1) || "").length / 4, true);
  assert.equal(high > graphCells(lines[0]).length / 2, true);
});

test("lineChart does not connect grant values across quota epochs", () => {
  const lines = lineChart([
    { timestampMs: 0, valueUsd: 100, epoch: 0 },
    { timestampMs: 10, valueUsd: 100, epoch: 0 },
    { timestampMs: 1_000, valueUsd: 10, epoch: 1 },
    { timestampMs: 1_010, valueUsd: 10, epoch: 1 },
  ], "valueUsd", 28, 9, "$");
  const mid = graphCells(lines[Math.floor(lines.length / 2)]);
  const center = mid.slice(Math.floor(mid.length * 0.35), Math.floor(mid.length * 0.65));
  assert.equal(/[\u2800-\u28FF]/.test(center), false);
});

test("lineChart fills the reset gap with dense dots", () => {
  const lines = lineChart([
    { timestampMs: 0, valueUsd: 100, epoch: 0, resetsAtMs: 500 },
    { timestampMs: 10, valueUsd: 100, epoch: 0, resetsAtMs: 500 },
    { timestampMs: 1_000, valueUsd: 10, epoch: 1 },
    { timestampMs: 1_010, valueUsd: 10, epoch: 1 },
  ], "valueUsd", 40, 9, "$");
  const mid = graphCells(lines[Math.floor(lines.length / 2)]);
  const dots = [...mid].filter((cell) => cell === "·").length;
  assert.equal(dots > 20, true);
  assert.equal(/[\u2800-\u28FF]/.test(mid), false);
  assert.equal(lines.every((line) => graphCells(line).includes(RESET_MARK)), true);
});

test("lineChart omits reset marks within a single epoch", () => {
  const lines = lineChart([
    { timestampMs: 0, valueUsd: 10, epoch: 0 },
    { timestampMs: 50, valueUsd: 20, epoch: 0 },
    { timestampMs: 100, valueUsd: 15, epoch: 0 },
  ], "valueUsd", 20, 9, "$");
  assert.equal(lines.some((line) => graphCells(line).includes(RESET_MARK)), false);
});
