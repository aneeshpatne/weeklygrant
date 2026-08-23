import assert from "node:assert/strict";
import test from "node:test";
import {
  box,
  isQuitKey,
  joinRow,
  normalizeKey,
  padVisible,
  stripAnsi,
  truncate,
  visibleWidth,
  wrapCards,
  wrapRow,
  wrapText,
} from "../src/bin/term.js";

test("normalizeKey maps letters, arrows, escape, and ctrl+c", () => {
  assert.equal(normalizeKey("q", { name: "q" }).input, "q");
  assert.equal(isQuitKey(normalizeKey("q", { name: "q" })), true);
  assert.equal(isQuitKey(normalizeKey("\x1b", { name: "escape", sequence: "\x1b" })), true);
  assert.equal(isQuitKey(normalizeKey("\x03", { name: "c", ctrl: true, sequence: "\x03" })), true);
  assert.equal(isQuitKey(normalizeKey("r", { name: "r" })), false);
  assert.equal(normalizeKey(undefined, { name: "left" }).leftArrow, true);
  assert.equal(normalizeKey(undefined, { name: "right" }).rightArrow, true);
  assert.equal(normalizeKey(undefined, { name: "up" }).upArrow, true);
  assert.equal(normalizeKey(undefined, { name: "down" }).downArrow, true);
  assert.equal(normalizeKey("-", { name: "-" }).input, "-");
  assert.equal(normalizeKey("+", { name: "+" }).input, "+");
  assert.equal(normalizeKey("\r", { name: "return" }).return, true);
});

test("truncate uses an ellipsis at the code-point boundary", () => {
  assert.equal(truncate("abcdefghijklmnopqrstuvwxyz", 8), "abcdefg…");
  assert.equal(truncate("short", 8), "short");
});

test("wrapText wraps labels to the inner width", () => {
  assert.deepEqual(wrapText("Estimated weekly API value", 20), ["Estimated weekly API", "value"]);
  assert.deepEqual(wrapText("fits", 20), ["fits"]);
});

test("round and double boxes include padding and borders", () => {
  const round = box(["hello"], { style: "round", paddingX: 1, width: 24 });
  assert.equal(round[0].startsWith("╭"), true);
  assert.equal(round.at(-1)?.startsWith("╰"), true);
  assert.equal(visibleWidth(round[0]), 24);
  assert.match(round[1], /hello/);

  const dbl = box(["warn"], { style: "double", paddingX: 2, paddingY: 1, width: 20 });
  assert.equal(dbl[0].startsWith("╔"), true);
  assert.equal(dbl.length, 5);
});

test("stat-card wrapping uses 1/3/4 cards at 40/80/120 columns", () => {
  const contents = Array.from({ length: 4 }, () => ["label", "value"]);
  const opts = { style: "round" as const, paddingX: 1, width: 24 };
  const card = box(contents[0], opts);
  const at40 = wrapCards(contents, 40, 1, opts);
  const at80 = wrapCards(contents, 80, 1, opts);
  const at120 = wrapCards(contents, 120, 1, opts);
  const rows = (lines: string[]) => 1 + lines.filter((line) => line === "").length;

  assert.equal(visibleWidth(card[0]), 24);
  assert.equal(rows(at40), 4);
  assert.equal(rows(at80), 2);
  assert.equal(rows(at120), 1);
  assert.equal(visibleWidth(joinRow([card, card], 1)[0]), 49);
  assert.equal(padVisible("x", 4), "x   ");
  assert.equal(stripAnsi("x").length, 1);
});

test("wrapCards stretches shorter boxes in a row to the same height", () => {
  const lines = wrapCards(
    [["Estimated weekly API", "value", "$42.00"], ["Confidence", "HIGH"]],
    80,
    1,
    { style: "round", paddingX: 1, width: 24 },
  );
  assert.equal(lines.length, 5);
  assert.equal(lines.at(-1)?.includes("╰──────────────────────╯ ╰──────────────────────╯"), true);
});
