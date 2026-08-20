import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO_URL = "https://github.com/aneeshpatne/weeklygrant";

type UserConfig = {
  hideStarNudge?: boolean;
};

export function userConfigPath() {
  if (process.env.WEEKLYGRANT_CONFIG) return process.env.WEEKLYGRANT_CONFIG;
  const dir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "weeklygrant")
    : path.join(os.homedir(), ".config", "weeklygrant");
  return path.join(dir, "config.json");
}

export function readUserConfig(): UserConfig {
  try {
    const raw = fs.readFileSync(userConfigPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isStarNudgeHidden() {
  return readUserConfig().hideStarNudge === true;
}

export function persistHideStarNudge() {
  const next = { ...readUserConfig(), hideStarNudge: true };
  const file = userConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}
