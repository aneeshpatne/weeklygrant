import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const project = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "weeklygrant-package-smoke-"));
const env = { ...process.env, npm_config_cache: path.join(temporary, "npm-cache") };

try {
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json"], {
    cwd: project,
    encoding: "utf8",
    env,
  }));
  const tarball = path.join(project, pack.filename);
  try {
    fs.writeFileSync(path.join(temporary, "package.json"), '{"private":true}\n');
    execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
      cwd: temporary,
      stdio: "pipe",
      env,
    });
    const cli = path.join(temporary, "node_modules", ".bin", "weeklygrant");
    const version = execFileSync(cli, ["--version"], { cwd: temporary, encoding: "utf8" }).trim();
    const help = execFileSync(cli, ["--help"], { cwd: temporary, encoding: "utf8" });
    const report = JSON.parse(execFileSync(cli, ["--json", "--redact", "--home", path.join(temporary, "empty")], {
      cwd: temporary,
      encoding: "utf8",
    }));
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`unexpected version output: ${version}`);
    if (!help.includes("Usage:")) throw new Error("packaged CLI help is missing usage text");
    if (report.codexHome !== "[redacted]" || report.filesScanned !== 0) throw new Error("packaged CLI JSON smoke check failed");
    console.log(`package smoke test passed for weeklygrant ${version}`);
  } finally {
    fs.rmSync(tarball, { force: true });
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
