import type { EstimateOptions } from "./codex-grant.js";

export type CliCommand = "estimate" | "usage" | "help" | "version";

export type CliOptions = {
  command: CliCommand;
  estimate: EstimateOptions;
  json: boolean;
  redact: boolean;
};

const COMMANDS = new Set<CliCommand>(["estimate", "usage", "help", "version"]);
const BOOLEAN_OPTIONS = new Set(["--json", "--all", "--refresh-prices", "--redact"]);
const VALUE_OPTIONS = new Set(["--home", "--days"]);

export function parseArgs(args: string[]): CliOptions {
  let command: CliCommand = "estimate";
  let commandSeen = false;
  let home: string | undefined;
  let daysValue: string | undefined;
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-h") return result("help");
    if (arg === "-v") return result("version");
    if (arg === "--help") return result("help");
    if (arg === "--version") return result("version");
    if (COMMANDS.has(arg as CliCommand)) {
      if (commandSeen) throw new Error(`Unexpected argument: ${arg}`);
      command = arg as CliCommand;
      commandSeen = true;
      continue;
    }
    if (BOOLEAN_OPTIONS.has(arg)) {
      if (flags.has(arg)) throw new Error(`Option specified more than once: ${arg}`);
      flags.add(arg);
      continue;
    }
    if (VALUE_OPTIONS.has(arg)) {
      if (flags.has(arg)) throw new Error(`Option specified more than once: ${arg}`);
      const value = args[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires a value`);
      flags.add(arg);
      index += 1;
      if (arg === "--home") home = value;
      else daysValue = value;
      continue;
    }
    throw new Error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unknown command: ${arg}`);
  }

  if (daysValue !== undefined && flags.has("--all")) throw new Error("--days and --all cannot be used together");
  const completeHistory = command === "usage" || flags.has("--json") || flags.has("--all");
  const days = daysValue === undefined ? (completeHistory ? Infinity : 30) : Number(daysValue);
  if (daysValue !== undefined && (!Number.isFinite(days) || days < 0)) throw new Error("--days must be a non-negative number");
  return {
    command,
    estimate: {
      ...(home === undefined ? {} : { home }),
      days,
      refreshPrices: flags.has("--refresh-prices"),
      includeUsageSeries: command === "usage" || flags.has("--json"),
      includeModelUsage: command === "usage" || flags.has("--json"),
    },
    json: flags.has("--json"),
    redact: flags.has("--redact"),
  };
}

function result(command: "help" | "version"): CliOptions {
  return { command, estimate: {}, json: false, redact: false };
}
