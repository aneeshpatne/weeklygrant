#!/usr/bin/env node

import { createRequire } from "node:module";
import { estimateCodexGrant } from "../lib/codex-grant.js";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`weeklygrant

Usage:
  weeklygrant [estimate] [options]
  weeklygrant <command>

Commands:
  estimate  Estimate the API-equivalent value of the weekly Codex grant (default)
  usage     Show token usage and API-equivalent value by model
  help     Show this help
  version  Print the CLI version

Options:
  --json          Print the complete report as JSON
  --home <path>   Use a specific Codex home (default: CODEX_HOME or ~/.codex)
  --days <n>      Only scan session files modified in the last n days
  --no-network    Do not fetch models.dev; use bundled pricing only
  --redact        Hide local filesystem paths in output
`);
}

if (command === "version" || command === "-v" || command === "--version") {
  const pkg = require("../package.json");
  console.log(pkg.version);
  process.exit(0);
}

if (command === "help" || command === "-h" || command === "--help") {
  printHelp();
  process.exit(0);
}

if (command && command !== "estimate" && command !== "usage" && command !== "--json" && !command.startsWith("--")) {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function money(value) {
  return value == null ? "Not enough data" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

function integer(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function printUsage(report) {
  if (!report.modelUsage.length) {
    console.log("No token usage found");
    return;
  }
  const rows = report.modelUsage.map((item) => {
    const value = item.pricedEvents
      ? `${money(item.apiValueUsd)}${item.pendingEvents ? " partial" : ""}`
      : "unpriced";
    return [
      item.model,
      integer(item.uncachedInputTokens),
      integer(item.cachedInputTokens),
      integer(item.outputTokens),
      integer(item.totalTokens),
      value,
    ];
  });
  const headers = ["Model", "Input", "Cached", "Output", "Total", "API value"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const line = (row) => row.map((cell, index) => index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index])).join("  ");
  console.log(line(headers));
  console.log(line(widths.map((width) => "─".repeat(width))));
  rows.forEach((row) => console.log(line(row)));
  console.log("\nAPI-equivalent planning value; not a Codex bill or credit balance.");
}

async function main() {
  const daysValue = option("--days");
  const days = daysValue === undefined ? Infinity : Number(daysValue);
  if (daysValue !== undefined && (!Number.isFinite(days) || days < 0)) throw new Error("--days must be a non-negative number");
  const estimateOptions = { home: option("--home"), days, noNetwork: args.includes("--no-network") };
  if (process.stdout.isTTY && !args.includes("--json")) {
    const { runTui } = await import("./tui.js");
    await runTui(estimateOptions, command === "usage" ? "usage" : "estimate");
    return;
  }
  const report = await estimateCodexGrant(estimateOptions);
  if (args.includes("--json")) {
    const output = args.includes("--redact") ? { ...report, codexHome: "[redacted]" } : report;
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  if (command === "usage") {
    printUsage(report);
    return;
  }
  console.log(money(report.headlineUsd));
  console.log(`${report.label} · ${report.confidence} confidence · based on ${report.coveragePoints.toFixed(1)} quota points`);
  if (report.weeklyUsedPercent != null) console.log(`Quota used: ${report.weeklyUsedPercent.toFixed(1)}%`);
  console.log(`Observed spend: ${money(report.observedTokenCostUsd)} · Current signal: ${money(report.rawUsd)}`);
  console.log(`Measurements: ${report.validPairs} valid pairs, ${report.pricedEvents} priced events, ${report.pendingEvents} pending events`);
  if (!report.filesScanned) console.log(args.includes("--redact") ? "No Codex JSONL sessions found" : `No Codex JSONL sessions found under ${report.codexHome}`);
}

main().catch((error) => {
  console.error(`weeklygrant: ${error.message}`);
  process.exitCode = 1;
});
