import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isStarNudgeHidden,
  persistHideStarNudge,
  readUserConfig,
  userConfigPath,
} from "../src/lib/user-config.js";

function withConfigFile(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-config-"));
  const previous = process.env.WEEKLYGRANT_CONFIG;
  process.env.WEEKLYGRANT_CONFIG = path.join(dir, "config.json");
  try {
    return run(process.env.WEEKLYGRANT_CONFIG);
  } finally {
    if (previous === undefined) delete process.env.WEEKLYGRANT_CONFIG;
    else process.env.WEEKLYGRANT_CONFIG = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("star nudge is shown when no config file exists", () => {
  withConfigFile(() => {
    assert.equal(isStarNudgeHidden(), false);
    assert.deepEqual(readUserConfig(), {});
  });
});

test("star nudge is hidden after persistHideStarNudge", () => {
  withConfigFile((file) => {
    persistHideStarNudge();
    assert.equal(isStarNudgeHidden(), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { hideStarNudge: true });
  });
});

test("malformed config does not hide the star nudge", () => {
  withConfigFile((file) => {
    fs.writeFileSync(file, "not-json");
    assert.equal(isStarNudgeHidden(), false);
  });
});

test("WEEKLYGRANT_CONFIG overrides the default path", () => {
  withConfigFile((file) => {
    assert.equal(userConfigPath(), file);
  });
});
