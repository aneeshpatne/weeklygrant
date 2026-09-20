import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isStarNudgeHidden, persistHideStarNudge } from "../src/lib/user-config.js";

test("star nudge can be hidden in the local config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-config-"));
  const previous = process.env.WEEKLYGRANT_CONFIG;
  process.env.WEEKLYGRANT_CONFIG = path.join(dir, "config.json");
  try {
    assert.equal(isStarNudgeHidden(), false);
    persistHideStarNudge();
    assert.equal(isStarNudgeHidden(), true);
  } finally {
    if (previous === undefined) delete process.env.WEEKLYGRANT_CONFIG;
    else process.env.WEEKLYGRANT_CONFIG = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
