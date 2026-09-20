import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO_URL = "https://github.com/aneeshpatne/weeklygrant";

type UserConfig = { hideStarNudge?: boolean };

function userConfigPath() {
  if (process.env.WEEKLYGRANT_CONFIG) return process.env.WEEKLYGRANT_CONFIG;
  const dir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "weeklygrant")
    : path.join(os.homedir(), ".config", "weeklygrant");
  return path.join(dir, "config.json");
}

function readUserConfig(): UserConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(userConfigPath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isStarNudgeHidden() {
  return readUserConfig().hideStarNudge === true;
}

export function persistHideStarNudge() {
  const file = userConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ ...readUserConfig(), hideStarNudge: true }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
