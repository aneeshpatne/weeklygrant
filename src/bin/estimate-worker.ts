import { parentPort, workerData } from "node:worker_threads";
import { estimateCodexGrant } from "../lib/codex-grant.js";

estimateCodexGrant(workerData).then(
  (report) => parentPort?.postMessage({ report }),
  (error) => parentPort?.postMessage({ error: error?.message || String(error) }),
);
