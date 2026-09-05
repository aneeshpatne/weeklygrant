import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const env = { ...process.env, npm_config_cache: path.join(os.tmpdir(), "weeklygrant-npm-cache") };
const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { encoding: "utf8", env }));
const limits = { size: 22_000, unpackedSize: 60_000 };

for (const [field, limit] of Object.entries(limits)) {
  if (pack[field] > limit) {
    throw new Error(`npm package ${field} is ${pack[field]} bytes; budget is ${limit}`);
  }
}

console.log(`package size: ${pack.size} bytes packed, ${pack.unpackedSize} bytes unpacked`);
