#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { parseArgs } from "../lib/args.js";
import { estimateCodexGrant } from "../lib/codex-grant.js";
import { integerFormat, moneyFormat } from "../lib/format.js";

const args = process.argv.slice(2);

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
  --all           Scan all available history for an estimate
  --refresh-prices  Look up unknown model prices on models.dev
  --redact        Hide local filesystem paths in output
`);
}

function money(value) {
  return value == null ? "Not enough data" : moneyFormat.format(value);
}

function integer(value) {
  return integerFormat.format(value);
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
  const parsed = parseArgs(args);
  const { command, estimate: estimateOptions } = parsed;
  if (command === "version") {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
    return;
  }
  if (command === "help") {
    printHelp();
    return;
  }
  if (process.stdout.isTTY && !parsed.json) {
    const { runTui } = await import("./tui.js");
    await runTui(estimateOptions, command === "usage" ? "usage" : "estimate");
    return;
  }
  const report = await estimateCodexGrant(estimateOptions);
  if (parsed.json) {
    const output = parsed.redact ? { ...report, codexHome: "[redacted]" } : report;
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  if (command === "usage") {
    printUsage(report);
    return;
  }
  console.log(money(report.headlineUsd));
  const basis = Number.isFinite(report.matchedCoveragePoints) ? report.matchedCoveragePoints : report.coveragePoints;
  console.log(`${report.label} · ${report.confidence} confidence · based on ${basis.toFixed(1)} quota points`);
  if (report.weeklyUsedPercent != null) console.log(`Quota used: ${report.weeklyUsedPercent.toFixed(1)}%`);
  console.log(`Observed spend: ${money(report.observedTokenCostUsd)} · Current signal: ${money(report.rawUsd)}`);
  if (report.fiveHour?.present) {
    const share = report.fiveHour.maxSpendPercentOfWeekly == null ? "unknown share" : `${report.fiveHour.maxSpendPercentOfWeekly.toFixed(1)}% of weekly`;
    console.log(`5-hour maximum: ${money(report.fiveHour.headlineUsd)} · ${share} · ${report.fiveHour.confidence} confidence`);
  }
  console.log(`Measurements: ${report.validPairs} valid pairs, ${report.pricedEvents} priced events, ${report.pendingEvents} pending events`);
  if (!report.filesScanned) console.log(parsed.redact ? "No Codex JSONL sessions found" : `No Codex JSONL sessions found under ${report.codexHome}`);
}

main().catch((error) => {
  console.error(`weeklygrant: ${error.message}`);
  process.exitCode = 1;
});
