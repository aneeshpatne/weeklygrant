import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import { Worker } from "node:worker_threads";

const h = React.createElement;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const RANGES: ReadonlyArray<readonly [string, number]> = [
  ["24h", 86_400_000],
  ["7d", 7 * 86_400_000],
  ["30d", 30 * 86_400_000],
  ["all", Infinity],
];
const METRICS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["grant", "Estimated grant", "valueUsd", "$"],
  ["quota", "Weekly quota used", "usedPercent", "%"],
  ["cost", "Observed API-equivalent cost", "observedCostUsd", "$"],
];
const USAGE_METRICS: ReadonlyArray<readonly [string, string, string]> = [
  ["Total tokens", "totalTokens", ""],
  ["Uncached input", "uncachedInputTokens", ""],
  ["Cached input", "cachedInputTokens", ""],
  ["Output tokens", "outputTokens", ""],
  ["API-equivalent value", "apiValueUsd", "$"],
];

function usd(value) {
  return value == null ? "—" : new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

function relativeTime(value) {
  if (!value) return "unknown";
  const delta = value - Date.now();
  const amount = Math.max(0, delta);
  const hours = Math.floor(amount / 3_600_000);
  const minutes = Math.floor((amount % 3_600_000) / 60_000);
  return delta > 0 ? `in ${hours}h ${minutes}m` : "due now";
}

function Loading() {
  const [frame, setFrame] = useState(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const spinner = setInterval(() => setFrame((value) => (value + 1) % SPINNER.length), 80);
    const clock = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => { clearInterval(spinner); clearInterval(clock); };
  }, []);
  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Text, { bold: true, color: "cyan" }, "weeklygrant"),
    h(Box, { marginTop: 1 },
      h(Text, { color: "cyan" }, `${SPINNER[frame]} `),
      h(Text, null, "Scanning Codex sessions and pricing tokens"),
      h(Text, { dimColor: true }, `  ${seconds}s`),
    ),
    h(Text, { dimColor: true }, "Loading public rate cards and pairing token cost with weekly quota…"),
  );
}

function WarningSplash({ report, onRetry }) {
  const { exit } = useApp();
  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
    if (input === "r") onRetry();
  });
  const needsPairs = Math.max(0, 2 - report.validPairs);
  const needsCoverage = Math.max(0, 5 - report.coveragePoints);
  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Text, { bold: true, color: "cyan" }, "weeklygrant"),
    h(Box, {
      marginTop: 1,
      borderStyle: "double",
      borderColor: "yellow",
      paddingX: 2,
      paddingY: 1,
      flexDirection: "column",
    },
      h(Text, { bold: true, color: "yellow" }, "⚠  Estimate not ready"),
      h(Box, { marginTop: 1, flexDirection: "column" },
        h(Text, null, "There is not enough reliable weekly-quota movement to show a value yet."),
        h(Text, null, "The current dollar signal and graph are hidden because they may be misleading."),
      ),
      h(Box, { marginTop: 1, flexDirection: "column" },
        h(Text, { dimColor: true }, `Confidence: ${report.confidence} · ${report.validPairs} valid pair${report.validPairs === 1 ? "" : "s"} · ${report.coveragePoints.toFixed(1)} quota points`),
        needsPairs > 0 && h(Text, { color: "yellow" }, `Need at least ${needsPairs} more valid measurement${needsPairs === 1 ? "" : "s"}.`),
        needsCoverage > 0 && h(Text, { color: "yellow" }, `Need about ${needsCoverage.toFixed(1)} more quota points of coverage.`),
      ),
      h(Box, { marginTop: 1, flexDirection: "column" },
        h(Text, null, "Use Codex normally, then rescan after weekly usage has moved."),
        h(Text, { dimColor: true }, "The estimate dashboard unlocks at medium or high confidence."),
      ),
    ),
    h(Box, { marginTop: 1 },
      h(Text, { color: "cyan" }, "r"), h(Text, null, " rescan  "),
      h(Text, { color: "cyan" }, "q"), h(Text, null, " quit"),
    ),
    h(Text, { dimColor: true }, "API-equivalent planning estimate — not a Codex bill or credit balance."),
  );
}

function Stat({ label, value, color = "white" }) {
  return h(Box, { borderStyle: "round", borderColor: "gray", width: 24, paddingX: 1, flexDirection: "column" },
    h(Text, { dimColor: true }, label),
    h(Text, { bold: true, color }, value),
  );
}

function setBraille(pixels, x, y) {
  const cellX = Math.floor(x / 2);
  const cellY = Math.floor(y / 4);
  const dotX = x % 2;
  const dotY = y % 4;
  const bits = [[1, 2, 4, 64], [8, 16, 32, 128]];
  pixels[cellY][cellX] |= bits[dotX][dotY];
}

function drawLine(pixels, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    setBraille(pixels, x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
}

function lineChart(points, field, width, height, prefix) {
  const clean = points.map((point) => Number(point[field])).filter(Number.isFinite);
  if (!clean.length) return ["No measurements in this range"];
  const cellWidth = Math.max(12, width);
  const pixelWidth = cellWidth * 2;
  const pixelHeight = height * 4;
  const sampleCount = Math.min(pixelWidth, clean.length);
  const sampled = Array.from({ length: sampleCount }, (_, index) => {
    const source = sampleCount === 1 ? clean.length - 1 : Math.round(index * (clean.length - 1) / (sampleCount - 1));
    return clean[source];
  });
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const span = max - min || 1;
  const pixels = Array.from({ length: height }, () => Array(cellWidth).fill(0));
  const coordinates = sampled.map((value, index) => ({
    x: sampleCount === 1 ? pixelWidth - 1 : Math.round(index * (pixelWidth - 1) / (sampleCount - 1)),
    y: pixelHeight - 1 - Math.round((value - min) / span * (pixelHeight - 1)),
  }));
  coordinates.forEach((point, index) => {
    if (index === 0) setBraille(pixels, point.x, point.y);
    else drawLine(pixels, coordinates[index - 1].x, coordinates[index - 1].y, point.x, point.y);
  });
  const format = (value) => prefix === "$" ? usd(value) : prefix === "%" ? `${value.toFixed(1)}%` : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const middle = min + span / 2;
  const labelWidth = Math.max(format(min).length, format(max).length, format(middle).length);
  return pixels.map((row, index) => {
    const axis = index === 0 ? format(max) : index === Math.floor(height / 2) ? format(middle) : index === height - 1 ? format(min) : "";
    const graph = row.map((bits) => bits ? String.fromCodePoint(0x2800 + bits) : " ").join("");
    return `${axis.padStart(labelWidth)} ${index === height - 1 ? "└" : "│"}${graph}`;
  });
}

function UsageDashboard({ report }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [modelIndex, setModelIndex] = useState(0);
  const [metricIndex, setMetricIndex] = useState(0);
  const [rangeIndex, setRangeIndex] = useState(3);
  const models = report.modelUsage || [];
  const selected = models[Math.min(modelIndex, Math.max(0, models.length - 1))];
  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
    if (key.leftArrow) setMetricIndex((value) => (value + USAGE_METRICS.length - 1) % USAGE_METRICS.length);
    if (key.rightArrow) setMetricIndex((value) => (value + 1) % USAGE_METRICS.length);
    if (key.upArrow && models.length) setModelIndex((value) => (value + models.length - 1) % models.length);
    if (key.downArrow && models.length) setModelIndex((value) => (value + 1) % models.length);
    if (input === "[") setRangeIndex((value) => (value + RANGES.length - 1) % RANGES.length);
    if (input === "]") setRangeIndex((value) => (value + 1) % RANGES.length);
  });
  const [metricTitle, field, suffix] = USAGE_METRICS[metricIndex];
  const [rangeName, rangeMs] = RANGES[rangeIndex];
  const points = useMemo(() => {
    if (!selected) return [];
    const cutoff = Number.isFinite(rangeMs) ? Date.now() - rangeMs : -Infinity;
    return (report.modelUsageSeries || []).filter((point) => point.model === selected.model && point.timestampMs >= cutoff);
  }, [report, selected, rangeMs]);
  const chartWidth = Math.min(96, Math.max(20, (stdout?.columns || 80) - 18));
  const chart = lineChart(points, field, chartWidth, 9, suffix);
  if (!selected) return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Text, { bold: true, color: "cyan" }, "weeklygrant usage"),
    h(Text, { dimColor: true }, "No token usage found · q quit"),
  );
  const valueLabel = selected.pricedEvents ? `${usd(selected.apiValueUsd)}${selected.pendingEvents ? " partial" : ""}` : "unpriced";
  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Box, { justifyContent: "space-between" },
      h(Text, { bold: true, color: "cyan" }, "weeklygrant usage"),
      h(Text, { dimColor: true }, `${models.length} models · ${report.filesScanned} session files`),
    ),
    h(Box, { marginTop: 1, gap: 1, flexWrap: "wrap" },
      h(Stat, { label: "Model", value: selected.model, color: "cyan" }),
      h(Stat, { label: "Total tokens", value: selected.totalTokens.toLocaleString("en-US") }),
      h(Stat, { label: "API-equivalent value", value: valueLabel, color: selected.pricedEvents ? "green" : "yellow" }),
      h(Stat, { label: "Output tokens", value: selected.outputTokens.toLocaleString("en-US"), color: "yellow" }),
    ),
    h(Box, { marginTop: 1, borderStyle: "round", borderColor: "cyan", paddingX: 1, flexDirection: "column" },
      h(Box, { justifyContent: "space-between" },
        h(Text, { bold: true }, metricTitle),
        h(Text, null, RANGES.map(([name], index) => h(Text, { key: name, color: index === rangeIndex ? "cyan" : "gray", bold: index === rangeIndex }, `${index ? "  " : ""}${name}`))),
      ),
      h(Text, { color: suffix === "$" ? "green" : "cyan" }, chart.join("\n")),
      h(Box, { justifyContent: "space-between" },
        h(Text, { dimColor: true }, new Date(points[0]?.timestampMs || Date.now()).toLocaleDateString()),
        h(Text, { dimColor: true }, `${points.length} events`),
        h(Text, { dimColor: true }, rangeName),
      ),
    ),
    h(Text, { dimColor: true }, `Input ${selected.uncachedInputTokens.toLocaleString("en-US")} · Cached ${selected.cachedInputTokens.toLocaleString("en-US")} · Output ${selected.outputTokens.toLocaleString("en-US")}`),
    h(Box, { marginTop: 1 },
      h(Text, { color: "cyan" }, "↑/↓"), h(Text, null, " model  "),
      h(Text, { color: "cyan" }, "←/→"), h(Text, null, " metric  "),
      h(Text, { color: "cyan" }, "[/]"), h(Text, null, " range  "),
      h(Text, { color: "cyan" }, "q"), h(Text, null, " quit"),
    ),
    h(Text, { dimColor: true }, "API-equivalent planning value — not a Codex bill or credit balance."),
  );
}

function Dashboard({ report }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [metricIndex, setMetricIndex] = useState(0);
  const [rangeIndex, setRangeIndex] = useState(1);
  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
    if (key.leftArrow) setMetricIndex((value) => (value + METRICS.length - 1) % METRICS.length);
    if (key.rightArrow) setMetricIndex((value) => (value + 1) % METRICS.length);
    if (key.upArrow) setRangeIndex((value) => (value + RANGES.length - 1) % RANGES.length);
    if (key.downArrow) setRangeIndex((value) => (value + 1) % RANGES.length);
  });
  const [metric, title, field, suffix] = METRICS[metricIndex];
  const [rangeName, rangeMs] = RANGES[rangeIndex];
  const points = useMemo(() => {
    const cutoff = Number.isFinite(rangeMs) ? Date.now() - rangeMs : -Infinity;
    return report.series.filter((point) => point.timestampMs >= cutoff);
  }, [report, rangeMs]);
  const chartWidth = Math.min(96, Math.max(20, (stdout?.columns || 80) - 18));
  const chart = lineChart(points, field, chartWidth, 9, suffix);
  const confidenceColor = { none: "gray", low: "yellow", medium: "cyan", high: "green" }[report.confidence];
  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Box, { justifyContent: "space-between" },
      h(Text, { bold: true, color: "cyan" }, "weeklygrant"),
      h(Text, { dimColor: true }, `${report.filesScanned} session files · ${report.algorithm}`),
    ),
    h(Box, { marginTop: 1, gap: 1, flexWrap: "wrap" },
      h(Stat, { label: "Estimated weekly API value", value: usd(report.headlineUsd), color: "green" }),
      h(Stat, { label: "Confidence", value: report.confidence.toUpperCase(), color: confidenceColor }),
      h(Stat, { label: "Weekly quota", value: report.weeklyUsedPercent == null ? "—" : `${report.weeklyUsedPercent.toFixed(1)}% used`, color: "cyan" }),
      h(Stat, { label: "Resets", value: relativeTime(report.resetsAtMs) }),
    ),
    h(Box, { marginTop: 1, borderStyle: "round", borderColor: "cyan", paddingX: 1, flexDirection: "column" },
      h(Box, { justifyContent: "space-between" },
        h(Text, { bold: true }, title),
        h(Text, null, RANGES.map(([name], index) => h(Text, { key: name, color: index === rangeIndex ? "cyan" : "gray", bold: index === rangeIndex }, `${index ? "  " : ""}${name}`))),
      ),
      h(Text, { color: metric === "grant" ? "green" : metric === "quota" ? "cyan" : "yellow" }, chart.join("\n")),
      h(Box, { justifyContent: "space-between" },
        h(Text, { dimColor: true }, new Date(points[0]?.timestampMs || Date.now()).toLocaleDateString()),
        h(Text, { dimColor: true }, `${points.length} measurements`),
        h(Text, { dimColor: true }, "now"),
      ),
    ),
    h(Box, { marginTop: 1, gap: 3 },
      h(Text, null, `Observed spend  ${usd(report.observedTokenCostUsd)}`),
      h(Text, null, `Current signal  ${usd(report.rawUsd)}`),
      h(Text, null, `Coverage  ${report.coveragePoints.toFixed(1)} pts`),
    ),
    h(Text, { dimColor: true }, `${report.validPairs} valid pairs · ${report.pricedEvents} priced events · ${report.pendingEvents} pending · plan ${report.planType || "unknown"}`),
    h(Text, { dimColor: true }, `Pricing: ${(report.pricingSources || []).join(" + ") || "unavailable"} · ${report.rateCardMode || "unknown mode"}`),
    h(Box, { marginTop: 1 },
      h(Text, { color: "cyan" }, "←/→"), h(Text, null, " graph  "),
      h(Text, { color: "cyan" }, "↑/↓"), h(Text, null, " range  "),
      h(Text, { color: "cyan" }, "q"), h(Text, null, " quit"),
    ),
    h(Text, { dimColor: true }, "API-equivalent planning estimate — not a Codex bill or credit balance."),
  );
}

function estimateInWorker(options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./estimate-worker.js", import.meta.url), { workerData: options });
    worker.once("message", ({ report, error }) => error ? reject(new Error(error)) : resolve(report));
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`Estimator worker exited with code ${code}`)); });
  });
}

function App({ options, view = "estimate" }) {
  const [state, setState] = useState({ loading: true, report: null, error: null });
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true, report: null, error: null });
    estimateInWorker(options).then(
      (report) => active && setState({ loading: false, report, error: null }),
      (error) => active && setState({ loading: false, report: null, error }),
    );
    return () => { active = false; };
  }, [options, generation]);
  if (state.loading) return h(Loading);
  if (state.error) return h(Text, { color: "red" }, `weeklygrant: ${state.error.message}`);
  if (view === "usage") return h(UsageDashboard, { report: state.report });
  if (state.report.confidence === "low" || state.report.confidence === "none") {
    return h(WarningSplash, { report: state.report, onRetry: () => setGeneration((value) => value + 1) });
  }
  return h(Dashboard, { report: state.report });
}

export async function runTui(options, view = "estimate") {
  const instance = render(h(App, { options, view }));
  await instance.waitUntilExit();
}
