import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../src/lib/args.js";

test("parseArgs applies command-specific history defaults", () => {
  assert.equal(parseArgs([]).estimate.days, 30);
  assert.equal(parseArgs(["usage"]).estimate.days, Infinity);
  assert.equal(parseArgs(["--json"]).estimate.includeModelUsage, true);
});

test("parseArgs accepts options before or after the command", () => {
  const parsed = parseArgs(["--home", "/tmp/codex", "usage", "--days", "7", "--redact"]);
  assert.equal(parsed.command, "usage");
  assert.equal(parsed.estimate.home, "/tmp/codex");
  assert.equal(parsed.estimate.days, 7);
  assert.equal(parsed.redact, true);
});

test("parseArgs rejects malformed arguments", () => {
  assert.throws(() => parseArgs(["--home", "--json"]), /requires a value/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown option/);
  assert.throws(() => parseArgs(["--days", "nope"]), /non-negative number/);
  assert.throws(() => parseArgs(["--days", "7", "--all"]), /cannot be used together/);
  assert.throws(() => parseArgs(["--json", "--json"]), /more than once/);
});
