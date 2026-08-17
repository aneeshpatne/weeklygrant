#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`weeklygrant

Usage:
  weeklygrant [command]

Commands:
  help     Show this help
  version  Print the CLI version
`);
}

if (command === "version" || command === "-v" || command === "--version") {
  const pkg = require("../package.json");
  console.log(pkg.version);
  process.exit(0);
}

if (!command || command === "help" || command === "-h" || command === "--help") {
  printHelp();
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
printHelp();
process.exit(1);
