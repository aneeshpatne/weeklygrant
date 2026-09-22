import assert from "node:assert/strict";
import test from "node:test";
import { isNewerVersion } from "../src/lib/update-check.js";

test("detects newer semantic versions", () => {
  assert.equal(isNewerVersion("1.4.0", "1.3.1"), true);
  assert.equal(isNewerVersion("2.0.0", "1.99.99"), true);
  assert.equal(isNewerVersion("1.3.1", "1.3.1"), false);
  assert.equal(isNewerVersion("1.2.9", "1.3.1"), false);
  assert.equal(isNewerVersion("not-a-version", "1.3.1"), false);
});
