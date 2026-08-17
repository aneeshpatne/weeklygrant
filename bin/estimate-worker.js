"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { estimateCodexGrant } = require("../lib/codex-grant");

estimateCodexGrant(workerData).then(
  (report) => parentPort.postMessage({ report }),
  (error) => parentPort.postMessage({ error: error?.message || String(error) }),
);
