import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { hasGraphableSeries, isStableEstimate } from "../lib/codex-grant.js";
import { lineChart, RESET_DOT, RESET_MARK } from "../lib/chart.js";
import { dateFormat, moneyFormat, signedPercent } from "../lib/format.js";
import {
  attach,
  box,
  isQuitKey,
  padVisible,
  padX,
  spaceBetween,
  style,
  type Color,
  type TermKey,
  type Terminal,
  wrapCards,
  wrapText,
} from "./term.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const STAT_WIDTH = 24;
const MIN_COLUMNS = 72;
const MIN_ROWS = 28;

type TuiPhase = "loading" | "ready" | "error";
export type TuiScreen = "loading" | "error" | "splash" | "dashboard";

export type TuiState = {
  phase: TuiPhase;
  report: any;
  error: string | null;
  spinner: number;
  seconds: number;
};

function usd(value) {
  return value == null ? "—" : moneyFormat.format(value);
}

function relativeTime(value) {
  if (!value) return "unknown";
  const delta = value - Date.now();
  const amount = Math.max(0, delta);
  const hours = Math.floor(amount / 3_600_000);
  const minutes = Math.floor((amount % 3_600_000) / 60_000);
  return delta > 0 ? `in ${hours}h ${minutes}m` : "due now";
}

export function withheldReason(report) {
  if (report.filesScanned === 0) return "No session logs found; check --home or try --all";
  if (report.pricedEvents === 0 && report.pendingEvents > 0) return "Usage has missing prices; try --refresh-prices";
  if (report.weeklyUsedPercent == null) return "No weekly quota observations found in the scanned logs";
  const needsPairs = Math.max(0, 2 - report.validPairs);
  const coverage = Number.isFinite(report.matchedCoveragePoints) ? report.matchedCoveragePoints : report.coveragePoints;
  const needsCoverage = Math.max(0, 5 - coverage);
  if (needsPairs > 0) return `Need at least ${needsPairs} more valid measurement${needsPairs === 1 ? "" : "s"}`;
  if (needsCoverage > 0) return `Need about ${needsCoverage.toFixed(1)} more quota points of coverage`;
  return "Need a more stable fit across measurements";
}

export function createState(): TuiState {
  return { phase: "loading", report: null, error: null, spinner: 0, seconds: 0 };
}

export function visibleScreen(state: TuiState): TuiScreen {
  if (state.phase === "loading") return "loading";
  if (state.phase === "error") return "error";
  if (state.report?.headlineUsd == null && !hasGraphableSeries(state.report?.series)) return "splash";
  return "dashboard";
}

function deltaColor(percent): Color {
  if (percent == null || !Number.isFinite(percent)) return "gray";
  if (percent <= -20) return "red";
  if (percent < -1) return "yellow";
  if (percent >= 1) return "green";
  return "gray";
}

function statCard(label: string, value: string, color: Color = "white") {
  const inner = STAT_WIDTH - 4;
  return [
    ...wrapText(label, inner).map((line) => style(line, { dim: true })),
    ...wrapText(value, inner).map((line) => style(line, { bold: true, color })),
  ];
}

function historyCard(label: string, percent, baselineUsd) {
  const delta = signedPercent(percent);
  return statCard(label, delta == null ? "—" : `${delta} · ${usd(baselineUsd)}`, deltaColor(percent));
}

function colorChartLine(line: string) {
  if (!line.includes(RESET_DOT)) return style(line, { color: "green" });
  return line.split(RESET_DOT).map((part, index) => `${index ? style(RESET_DOT, { color: "magenta" }) : ""}${style(part, { color: "green" })}`).join("");
}

function hint(pairs: Array<[string, string]>) {
  return pairs.flatMap(([key, label], index) => [
    ...(index ? ["  "] : []),
    style(key, { color: "cyan" }),
    ` ${label}`,
  ]).join("");
}

function resizePrompt(columns: number, rows: number) {
  const width = Math.max(1, columns - 2);
  return padX([
    style("Expand terminal size to view weeklygrant", { color: "yellow", bold: true }),
    style(`Current ${columns}×${rows} · minimum ${MIN_COLUMNS}×${MIN_ROWS}`, { dim: true }),
  ].map((line) => padVisible(line, width).trimEnd()), 1);
}

export function renderFrame(state: TuiState, columns = 80, rows = Infinity) {
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) return resizePrompt(columns, rows);
  const width = Math.max(1, columns - 2);
  const lines = renderScreen(state, visibleScreen(state), width);
  if (lines.length >= rows) return resizePrompt(columns, rows);
  return padX(lines.map((line) => padVisible(line, width).trimEnd()), 1);
}

function renderScreen(state: TuiState, screen: TuiScreen, width: number): string[] {
  if (screen === "loading") {
    const frame = SPINNER[state.spinner % SPINNER.length];
    return [
      style("weeklygrant", { bold: true, color: "cyan" }),
      "",
      `${style(`${frame} `, { color: "cyan" })}Scanning Codex sessions and pricing tokens${style(`  ${state.seconds}s`, { dim: true })}`,
      style("Pairing token cost from official rate cards with weekly quota…", { dim: true }),
    ];
  }
  if (screen === "error") {
    return [
      style(`weeklygrant: ${state.error || "unknown error"}`, { color: "red" }),
      hint([["r", "retry"], ["q", "quit"]]),
    ];
  }
  if (screen === "splash") {
    const report = state.report;
    const inner = box([
      style("⚠  Estimate not ready", { bold: true, color: "yellow" }),
      "",
      "There is not enough weekly-quota history to graph or estimate yet.",
      `Observed API-equivalent cost: ${usd(report.observedTokenCostUsd)}`,
      "",
      style(`Confidence: ${report.confidence} · ${report.validPairs} valid pair${report.validPairs === 1 ? "" : "s"} · ${report.coveragePoints.toFixed(1)} quota points`, { dim: true }),
      style(`${withheldReason(report)}.`, { color: "yellow" }),
      "",
      "Use Codex normally, then rescan after weekly usage has moved.",
    ], { style: "double", borderColor: "yellow", paddingX: 2, paddingY: 1, width: Math.min(width, 78) });
    return [
      style("weeklygrant", { bold: true, color: "cyan" }),
      "",
      ...inner,
      "",
      hint([["r", "rescan"], ["q", "quit"]]),
      style("API-equivalent planning estimate — not a Codex bill or credit balance.", { dim: true }),
    ];
  }
  return renderDashboard(state, width);
}

function renderDashboard(state: TuiState, width: number) {
  const report = state.report;
  const estimateReady = isStableEstimate(report.confidence);
  const points = report.series || [];
  const epochCount = new Set(points.map((point) => point.epoch).filter((epoch) => epoch != null)).size;
  const chartWidth = Math.min(96, Math.max(20, width - 16));
  const chart = lineChart(points, "valueUsd", chartWidth, 7, "$");
  const panelWidth = Math.min(width, chartWidth + 16);
  const cards = wrapCards([
    statCard("Estimated weekly API value", usd(report.headlineUsd), estimateReady ? "green" : "yellow"),
    statCard("Weekly quota", report.weeklyUsedPercent == null ? "—" : `${report.weeklyUsedPercent.toFixed(1)}% used`, "cyan"),
    statCard("Resets", relativeTime(report.resetsAtMs)),
    ...(estimateReady && report.history?.comparableWeeks >= 2 ? [
      historyCard("Vs scanned peak", report.history.vsPeakPercent, report.history.peakUsd),
      historyCard("Vs scanned average", report.history.vsAveragePercent, report.history.averageUsd),
    ] : []),
  ], width, 1, { style: "round", borderColor: "gray", paddingX: 1, width: STAT_WIDTH });
  const panelInner = Math.max(12, panelWidth - 4);
  const chartFooter = spaceBetween(
    style(dateFormat.format(points[0]?.timestampMs || Date.now()), { dim: true }),
    style(`${points.length} measurements${epochCount > 1 ? ` · ${RESET_MARK} reset` : ""} · now`, { dim: true }),
    panelInner,
  );
  return [
    spaceBetween(
      style("weeklygrant", { bold: true, color: "cyan" }),
      style(`${String(report.confidence).toUpperCase()} confidence`, { color: estimateReady ? "green" : "yellow" }),
      width,
    ),
    "",
    ...cards,
    ...(!estimateReady ? ["", style(`${report.headlineUsd == null ? "Estimate unavailable" : "Early estimate · low confidence"} · ${withheldReason(report)}.`, { color: "yellow" })] : []),
    "",
    ...box([
      style("Estimated grant history", { bold: true }),
      ...chart.map(colorChartLine),
      chartFooter,
    ], { style: "round", borderColor: "cyan", paddingX: 1, width: panelWidth }),
    "",
    `Observed spend  ${usd(report.observedTokenCostUsd)}   Coverage  ${report.coveragePoints.toFixed(1)} pts`,
    style(`${report.validPairs} valid pairs · ${report.pricedEvents} priced events · ${report.pendingEvents} pending · ${report.filesScanned} session files`, { dim: true }),
    "",
    hint([["r", "rescan"], ["q", "quit"]]),
    style("API-equivalent planning estimate — not a Codex bill or credit balance.", { dim: true }),
  ];
}

export type TuiAction = "quit" | "retry";

export function applyReport(state: TuiState, report): TuiState {
  return { ...state, phase: "ready", report, error: null };
}

export function applyError(state: TuiState, error: string): TuiState {
  return { ...state, phase: "error", report: null, error };
}

function tickLoading(state: TuiState, elapsedMs: number): TuiState {
  if (state.phase !== "loading") return state;
  return {
    ...state,
    spinner: Math.floor(elapsedMs / 80) % SPINNER.length,
    seconds: Math.floor(elapsedMs / 1000),
  };
}

export function handleKey(state: TuiState, key: TermKey): { state: TuiState; actions: TuiAction[] } {
  if (isQuitKey(key)) return { state, actions: ["quit"] };
  if (key.input === "r" && state.phase !== "loading") {
    return {
      state: { ...state, phase: "loading", report: null, error: null, spinner: 0, seconds: 0 },
      actions: ["retry"],
    };
  }
  return { state, actions: [] };
}

function estimateInWorker(options): { worker: Worker; done: Promise<any> } {
  const workerUrl = new URL("./estimate-worker.js", import.meta.url);
  const worker = existsSync(workerUrl)
    ? new Worker(workerUrl, { workerData: options })
    : new Worker(`import('tsx/esm/api').then(({register}) => { register(); return import(${JSON.stringify(new URL("./estimate-worker.ts", import.meta.url).href)}); });`, { eval: true, workerData: options });
  const done = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, report?: any) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(report);
    };
    worker.once("message", ({ report, error }) => finish(error ? new Error(error) : null, report));
    worker.once("error", (error) => finish(error instanceof Error ? error : new Error(String(error))));
    worker.once("exit", (code) => finish(new Error(`Estimator worker exited without a report (code ${code})`)));
  });
  return { worker, done };
}

async function runSession(term: Terminal, options) {
  let state = createState();
  let generation = 0;
  let loadingStarted = Date.now();
  let activeWorker: Worker | null = null;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;

  const paint = () => {
    if (!closed) term.writeFrame(renderFrame(state, term.columns, term.rows));
  };
  const scheduleTick = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (closed || state.phase !== "loading") return;
    timer = setTimeout(() => {
      state = tickLoading(state, Date.now() - loadingStarted);
      paint();
      scheduleTick();
    }, 80);
  };
  const load = (gen: number) => {
    loadingStarted = Date.now();
    activeWorker?.terminate();
    const { worker, done } = estimateInWorker(options);
    activeWorker = worker;
    done.then(
      (report) => {
        if (gen !== generation) return;
        state = applyReport(state, report);
        paint();
        scheduleTick();
      },
      (error) => {
        if (gen !== generation) return;
        state = applyError(state, error?.message || String(error));
        paint();
        scheduleTick();
      },
    );
  };

  return await new Promise<void>((resolve) => {
    const finish = () => {
      if (closed) return;
      closed = true;
      generation += 1;
      if (timer) clearTimeout(timer);
      activeWorker?.terminate();
      resolve();
    };
    term.onKey((key) => {
      const next = handleKey(state, key);
      state = next.state;
      paint();
      for (const action of next.actions) {
        if (action === "quit") finish();
        if (action === "retry") {
          generation += 1;
          load(generation);
        }
      }
      scheduleTick();
    });
    term.onResize(paint);
    paint();
    scheduleTick();
    load(generation);
  });
}

export async function runTui(options) {
  const term = attach();
  try {
    await runSession(term, options);
  } finally {
    term.detach();
  }
}
