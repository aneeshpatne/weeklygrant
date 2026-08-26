import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import { hasGraphableSeries, isStableEstimate } from "../lib/codex-grant.js";
import { lineChart, RESET_DOT, RESET_MARK } from "../lib/chart.js";
import { dateFormat, integerFormat, moneyFormat } from "../lib/format.js";
import { isStarNudgeHidden, persistHideStarNudge, REPO_URL } from "../lib/user-config.js";
import {
  attach,
  box,
  isQuitKey,
  padX,
  spaceBetween,
  style,
  type Color,
  type TermKey,
  type Terminal,
  wrapCards,
  wrapText,
  visibleWidth,
} from "./term.js";

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
const STAT_WIDTH = 24;
const THANK_YOU_ART = [
  String.raw` _____ _   _    _    _   _ _  __`,
  String.raw`|_   _| | | |  / \  | \ | | |/ /`,
  String.raw`  | | | |_| | / _ \ |  \| | ' / `,
  String.raw`  | | |  _  |/ ___ \| |\  | . \ `,
  String.raw`  |_| |_| |_/_/   \_\_| \_|_|\_\ `,
  "",
  String.raw`__   _____  _   _`,
  String.raw`\ \ / / _ \| | | |`,
  String.raw` \ V / | | | | | |`,
  String.raw`  | |  |_| | |_| |`,
  String.raw`  |_| \___/ \___/ `,
];
const THANK_YOU_ART_WIDTH = Math.max(...THANK_YOU_ART.map((line) => line.length));

export type TuiView = "estimate" | "usage";
export type TuiPhase = "loading" | "ready" | "error" | "leaving";
export type TuiScreen = "loading" | "error" | "splash" | "dashboard" | "usage" | "thanks";

export type TuiState = {
  view: TuiView;
  phase: TuiPhase;
  report: any;
  error: string | null;
  spinner: number;
  seconds: number;
  metricIndex: number;
  rangeIndex: number;
  modelIndex: number;
};

export function usd(value) {
  return value == null ? "—" : moneyFormat.format(value);
}

export function relativeTime(value) {
  if (!value) return "unknown";
  const delta = value - Date.now();
  const amount = Math.max(0, delta);
  const hours = Math.floor(amount / 3_600_000);
  const minutes = Math.floor((amount % 3_600_000) / 60_000);
  return delta > 0 ? `in ${hours}h ${minutes}m` : "due now";
}

export function withheldReason(report) {
  const needsPairs = Math.max(0, 2 - report.validPairs);
  const coverage = Number.isFinite(report.matchedCoveragePoints) ? report.matchedCoveragePoints : report.coveragePoints;
  const needsCoverage = Math.max(0, 5 - coverage);
  if (needsPairs > 0) return `Need at least ${needsPairs} more valid measurement${needsPairs === 1 ? "" : "s"}`;
  if (needsCoverage > 0) return `Need about ${needsCoverage.toFixed(1)} more quota points of coverage`;
  return "Need a more stable fit across measurements";
}

export function createState(view: TuiView = "estimate"): TuiState {
  return {
    view,
    phase: "loading",
    report: null,
    error: null,
    spinner: 0,
    seconds: 0,
    metricIndex: 0,
    rangeIndex: view === "usage" ? 3 : 1,
    modelIndex: 0,
  };
}

export function visibleScreen(state: TuiState): TuiScreen {
  if (state.phase === "loading") return "loading";
  if (state.phase === "error") return "error";
  if (state.phase === "leaving") return "thanks";
  if (state.view === "usage") return "usage";
  if (!isStableEstimate(state.report?.confidence) && !hasGraphableSeries(state.report?.series)) return "splash";
  return "dashboard";
}

function confidenceColor(confidence: string): Color {
  return { none: "gray", low: "yellow", medium: "cyan", high: "green" }[confidence] as Color || "white";
}

function statCard(label: string, value: string, color: Color = "white") {
  const inner = STAT_WIDTH - 4;
  return [
    ...wrapText(label, inner).map((line) => style(line, { dim: true })),
    ...wrapText(String(value), inner).map((line) => style(line, { bold: true, color })),
  ];
}

function centerText(text: string, width: number) {
  const w = visibleWidth(text);
  if (w >= width) return text;
  return `${" ".repeat(Math.floor((width - w) / 2))}${text}`;
}

function colorChartLine(line: string, color: Color) {
  if (!line.includes(RESET_DOT)) return style(line, { color });
  return line.split(RESET_DOT).map((part, index) => `${index ? style(RESET_DOT, { color: "magenta" }) : ""}${style(part, { color })}`).join("");
}

function hint(pairs: Array<[string, string]>) {
  return pairs.flatMap(([key, label], index) => [
    ...(index ? [style("  ", {})] : []),
    style(key, { color: "cyan" }),
    ` ${label}`,
  ]).join("");
}

function rangesFor(view: TuiView, report: any): ReadonlyArray<readonly [string, number]> {
  if (view === "usage" || !Number.isFinite(report?.scanWindowDays)) return RANGES;
  const availableMs = report.scanWindowDays * 86_400_000;
  return RANGES.filter(([, rangeMs]) => Number.isFinite(rangeMs) && rangeMs <= availableMs);
}

function rangeTabs(rangeIndex: number, ranges = RANGES) {
  return ranges.map(([name], index) => {
    const label = style(name, index === rangeIndex ? { color: "cyan", bold: true } : { color: "gray" });
    return `${index ? "  " : ""}${label}`;
  }).join("");
}

function chartPanel(title: string, chart: string[], color: Color, left: string, middle: string, right: string, rangeIndex: number, width: number, ranges = RANGES) {
  const inner = Math.max(12, width - 4);
  const header = spaceBetween(style(title, { bold: true }), rangeTabs(rangeIndex, ranges), inner);
  const footer = spaceBetween(spaceBetween(style(left, { dim: true }), style(middle, { dim: true }), Math.floor(inner * 2 / 3)), style(right, { dim: true }), inner);
  return box([
    header,
    ...chart.map((line) => colorChartLine(line, color)),
    footer,
  ], { style: "round", borderColor: "cyan", paddingX: 1, width });
}

function keys(screen: TuiScreen) {
  if (screen === "splash") return hint([["r", "rescan"], ["q", "quit"]]);
  if (screen === "usage") return hint([["↑/↓", "model"], ["←/→", "metric"], ["-/+", "range"], ["q", "quit"]]);
  if (screen === "dashboard") return hint([["←/→", "graph"], ["↑/↓", "range"], ["r", "rescan"], ["q", "quit"]]);
  if (screen === "thanks") return hint([["s", "open"], ["n", "don't show again"], ["q", "quit"]]);
  return hint([["q", "quit"]]);
}

export function renderFrame(state: TuiState, columns = 80) {
  const width = Math.max(20, columns - 2);
  const screen = visibleScreen(state);
  const lines = renderScreen(state, screen, width);
  return padX(lines, 1);
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
    return [style(`weeklygrant: ${state.error || "unknown error"}`, { color: "red" })];
  }
  if (screen === "thanks") {
    const boxWidth = Math.min(width, 64);
    const textWidth = Math.max(1, boxWidth - 6);
    const showArt = textWidth >= THANK_YOU_ART_WIDTH;
    const art = showArt ? THANK_YOU_ART.map((line) => style(line, { bold: true, color: "cyan" })) : [];
    const inner = box([
      ...art,
      ...(showArt ? [""] : []),
      ...(!showArt ? [style(centerText("THANK YOU", textWidth), { bold: true, color: "cyan" })] : []),
      "",
      "If this was useful, star the repo.",
      style(REPO_URL, { color: "cyan" }),
    ], { style: "round", borderColor: "cyan", paddingX: 2, paddingY: 1, width: boxWidth });
    return [
      style("weeklygrant", { bold: true, color: "cyan" }),
      "",
      ...inner,
      "",
      keys(screen),
    ];
  }
  if (screen === "splash") {
    const report = state.report;
    const inner = box([
      style("⚠  Estimate not ready", { bold: true, color: "yellow" }),
      "",
      "There is not enough weekly-quota history to graph or estimate yet.",
      "The dollar value stays hidden until there is a stable weekly signal.",
      "",
      style(`Confidence: ${report.confidence} · ${report.validPairs} valid pair${report.validPairs === 1 ? "" : "s"} · ${report.coveragePoints.toFixed(1)} quota points`, { dim: true }),
      style(`${withheldReason(report)}.`, { color: "yellow" }),
      "",
      "Use Codex normally, then rescan after weekly usage has moved.",
      style("The estimate dashboard unlocks at medium or high confidence.", { dim: true }),
    ], { style: "double", borderColor: "yellow", paddingX: 2, paddingY: 1, width: Math.min(width, 78) });
    return [
      style("weeklygrant", { bold: true, color: "cyan" }),
      "",
      ...inner,
      "",
      keys(screen),
      style("API-equivalent planning estimate — not a Codex bill or credit balance.", { dim: true }),
    ];
  }
  if (screen === "usage") return renderUsage(state, width);
  return renderDashboard(state, width);
}

function renderDashboard(state: TuiState, width: number) {
  const report = state.report;
  const estimateReady = isStableEstimate(report.confidence);
  const ranges = rangesFor(state.view, report);
  const metricIndex = ((state.metricIndex % METRICS.length) + METRICS.length) % METRICS.length;
  const rangeIndex = ((state.rangeIndex % ranges.length) + ranges.length) % ranges.length;
  const [metric, title, field, suffix] = METRICS[metricIndex];
  const [, rangeMs] = ranges[rangeIndex];
  const cutoff = Number.isFinite(rangeMs) ? Date.now() - rangeMs : -Infinity;
  const points = (report.series || []).filter((point) => point.timestampMs >= cutoff);
  const epochCount = new Set(points.map((point) => point.epoch).filter((epoch) => epoch != null)).size;
  const chartWidth = Math.min(96, Math.max(20, width - 16));
  const chart = lineChart(points, field, chartWidth, 9, suffix);
  const panelWidth = Math.min(width, chartWidth + 16);
  const cards = wrapCards([
    statCard("Estimated weekly API value", usd(estimateReady ? report.headlineUsd : null), estimateReady ? "green" : "gray"),
    statCard("Confidence", String(report.confidence).toUpperCase(), confidenceColor(report.confidence)),
    statCard("Weekly quota", report.weeklyUsedPercent == null ? "—" : `${report.weeklyUsedPercent.toFixed(1)}% used`, "cyan"),
    statCard("Resets", relativeTime(report.resetsAtMs)),
  ], width, 1, { style: "round", borderColor: "gray", paddingX: 1, width: STAT_WIDTH });
  const footer = [
    `Observed spend  ${usd(report.observedTokenCostUsd)}`,
    `Current signal  ${usd(estimateReady ? report.rawUsd : null)}`,
    `Coverage  ${report.coveragePoints.toFixed(1)} pts`,
  ].join("   ");
  return [
    spaceBetween(style("weeklygrant", { bold: true, color: "cyan" }), style(`${report.filesScanned} session files · ${report.algorithm}`, { dim: true }), width),
    "",
    ...cards,
    ...(!estimateReady ? ["", style(`Estimate withheld · ${withheldReason(report)}.`, { color: "yellow" })] : []),
    "",
    ...chartPanel(title, chart, metric === "grant" ? "green" : metric === "quota" ? "cyan" : "yellow",
      dateFormat.format(points[0]?.timestampMs || Date.now()),
      `${points.length} measurements${epochCount > 1 ? ` · ${RESET_MARK} reset` : ""}`,
      "now",
      rangeIndex,
      panelWidth,
      ranges,
    ),
    "",
    footer,
    style(`${report.validPairs} valid pairs${report.outlierPairs ? ` · ${report.outlierPairs} outliers` : ""} · ${report.pricedEvents} priced events · ${report.pendingEvents} pending · plan ${report.planType || "unknown"}`, { dim: true }),
    style(`Pricing: ${(report.pricingSources || []).join(" + ") || "unavailable"} · ${report.rateCardMode || "unknown mode"}`, { dim: true }),
    "",
    keys("dashboard"),
    style("API-equivalent planning estimate — not a Codex bill or credit balance.", { dim: true }),
  ];
}

function renderUsage(state: TuiState, width: number) {
  const report = state.report;
  const models = report.modelUsage || [];
  if (!models.length) {
    return [
      style("weeklygrant usage", { bold: true, color: "cyan" }),
      style("No token usage found · q quit", { dim: true }),
    ];
  }
  const modelIndex = ((state.modelIndex % models.length) + models.length) % models.length;
  const metricIndex = ((state.metricIndex % USAGE_METRICS.length) + USAGE_METRICS.length) % USAGE_METRICS.length;
  const rangeIndex = Math.min(RANGES.length - 1, Math.max(0, state.rangeIndex));
  const selected = models[modelIndex];
  const [metricTitle, field, suffix] = USAGE_METRICS[metricIndex];
  const [rangeName, rangeMs] = RANGES[rangeIndex];
  const cutoff = Number.isFinite(rangeMs) ? Date.now() - rangeMs : -Infinity;
  const points = (report.modelUsageSeries || []).filter((point) => point.model === selected.model && point.timestampMs >= cutoff);
  const chartWidth = Math.min(96, Math.max(20, width - 16));
  const chart = lineChart(points, field, chartWidth, 9, suffix);
  const panelWidth = Math.min(width, chartWidth + 16);
  const valueLabel = selected.pricedEvents ? `${usd(selected.apiValueUsd)}${selected.pendingEvents ? " partial" : ""}` : "unpriced";
  const cards = wrapCards([
    statCard("Model", selected.model, "cyan"),
    statCard("Total tokens", integerFormat.format(selected.totalTokens)),
    statCard("API-equivalent value", valueLabel, selected.pricedEvents ? "green" : "yellow"),
    statCard("Output tokens", integerFormat.format(selected.outputTokens), "yellow"),
  ], width, 1, { style: "round", borderColor: "gray", paddingX: 1, width: STAT_WIDTH });
  return [
    spaceBetween(style("weeklygrant usage", { bold: true, color: "cyan" }), style(`${models.length} models · ${report.filesScanned} session files`, { dim: true }), width),
    "",
    ...cards,
    "",
    ...chartPanel(metricTitle, chart, suffix === "$" ? "green" : "cyan",
      dateFormat.format(points[0]?.timestampMs || Date.now()),
      `${points.length} events`,
      rangeName,
      rangeIndex,
      panelWidth,
    ),
    style(`Input ${integerFormat.format(selected.uncachedInputTokens)} · Cached ${integerFormat.format(selected.cachedInputTokens)} · Output ${integerFormat.format(selected.outputTokens)}`, { dim: true }),
    "",
    keys("usage"),
    style("API-equivalent planning value — not a Codex bill or credit balance.", { dim: true }),
  ];
}

export type TuiAction = "quit" | "retry" | "open-repo" | "hide-nudge";

export function applyReport(state: TuiState, report): TuiState {
  const estimateReady = isStableEstimate(report.confidence);
  const ranges = rangesFor(state.view, report);
  return {
    ...state,
    phase: "ready",
    report,
    error: null,
    metricIndex: state.view === "usage" ? 0 : (estimateReady ? 0 : 1),
    rangeIndex: state.view === "usage" ? 3 : (estimateReady ? Math.min(1, ranges.length - 1) : ranges.length - 1),
    modelIndex: 0,
  };
}

export function applyError(state: TuiState, error: string): TuiState {
  return { ...state, phase: "error", report: null, error };
}

export function tickLoading(state: TuiState, elapsedMs: number): TuiState {
  if (state.phase !== "loading") return state;
  return {
    ...state,
    spinner: Math.floor(elapsedMs / 80) % SPINNER.length,
    seconds: Math.floor(elapsedMs / 1000),
  };
}

export function tickThankYou(state: TuiState): TuiState {
  if (state.phase !== "leaving") return state;
  return { ...state, spinner: state.spinner + 1 };
}

function requestQuit(state: TuiState): { state: TuiState; actions: TuiAction[] } {
  const usedApp = state.phase === "ready";
  if (!usedApp || isStarNudgeHidden()) return { state, actions: ["quit"] };
  return { state: { ...state, phase: "leaving", spinner: 0 }, actions: [] };
}

export function handleKey(state: TuiState, key: TermKey): { state: TuiState; actions: TuiAction[] } {
  const screen = visibleScreen(state);
  if (screen === "thanks") {
    if (key.input === "n") return { state, actions: ["hide-nudge", "quit"] };
    if (key.input === "s") return { state, actions: ["open-repo"] };
    if (isQuitKey(key) || key.return) return { state, actions: ["quit"] };
    return { state, actions: [] };
  }
  if (isQuitKey(key)) return requestQuit(state);
  if (screen === "splash") {
    if (key.input === "r") return { state: { ...state, phase: "loading", report: null, error: null, spinner: 0, seconds: 0 }, actions: ["retry"] };
    return { state, actions: [] };
  }
  if (screen === "dashboard") {
    const rangeCount = rangesFor(state.view, state.report).length;
    if (key.input === "r") return { state: { ...state, phase: "loading", report: null, error: null, spinner: 0, seconds: 0 }, actions: ["retry"] };
    if (key.leftArrow) return { state: { ...state, metricIndex: (state.metricIndex + METRICS.length - 1) % METRICS.length }, actions: [] };
    if (key.rightArrow) return { state: { ...state, metricIndex: (state.metricIndex + 1) % METRICS.length }, actions: [] };
    if (key.upArrow) return { state: { ...state, rangeIndex: (state.rangeIndex + rangeCount - 1) % rangeCount }, actions: [] };
    if (key.downArrow) return { state: { ...state, rangeIndex: (state.rangeIndex + 1) % rangeCount }, actions: [] };
    return { state, actions: [] };
  }
  if (screen === "usage") {
    const modelCount = state.report?.modelUsage?.length || 0;
    if (key.leftArrow) return { state: { ...state, metricIndex: (state.metricIndex + USAGE_METRICS.length - 1) % USAGE_METRICS.length }, actions: [] };
    if (key.rightArrow) return { state: { ...state, metricIndex: (state.metricIndex + 1) % USAGE_METRICS.length }, actions: [] };
    if (key.upArrow && modelCount) return { state: { ...state, modelIndex: (state.modelIndex + modelCount - 1) % modelCount }, actions: [] };
    if (key.downArrow && modelCount) return { state: { ...state, modelIndex: (state.modelIndex + 1) % modelCount }, actions: [] };
    if (key.input === "-") return { state: { ...state, rangeIndex: Math.max(0, state.rangeIndex - 1) }, actions: [] };
    if (key.input === "+" || key.input === "=") return { state: { ...state, rangeIndex: Math.min(RANGES.length - 1, state.rangeIndex + 1) }, actions: [] };
    return { state, actions: [] };
  }
  return { state, actions: [] };
}

function openInBrowser(url: string) {
  const options = { stdio: "ignore" as const, detached: true };
  try {
    if (process.platform === "darwin") spawn("open", [url], options).unref();
    else if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], options).unref();
    else spawn("xdg-open", [url], options).unref();
  } catch {}
}

function estimateInWorker(options): { worker: Worker; done: Promise<any> } {
  const worker = new Worker(new URL("./estimate-worker.js", import.meta.url), { workerData: options });
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
    worker.once("exit", (code) => { if (code !== 0) finish(new Error(`Estimator worker exited with code ${code}`)); });
  });
  return { worker, done };
}

async function runSession(term: Terminal, options, view: TuiView) {
  let state = createState(view);
  let generation = 0;
  let loadingStarted = Date.now();
  let activeWorker: Worker | null = null;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;

  const paint = () => {
    if (closed) return;
    term.writeFrame(renderFrame(state, term.columns));
  };

  const scheduleTick = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (closed || (state.phase !== "loading" && state.phase !== "leaving")) return;
    const delay = state.phase === "loading" ? 80 : 320;
    timer = setTimeout(() => {
      state = state.phase === "loading"
        ? tickLoading(state, Date.now() - loadingStarted)
        : tickThankYou(state);
      paint();
      scheduleTick();
    }, delay);
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
    const applyActions = (actions: TuiAction[]) => {
      for (const action of actions) {
        if (action === "quit") finish();
        if (action === "retry") {
          generation += 1;
          load(generation);
        }
        if (action === "open-repo") openInBrowser(REPO_URL);
        if (action === "hide-nudge") {
          try { persistHideStarNudge(); } catch {}
        }
      }
    };

    term.onKey((key) => {
      const next = handleKey(state, key);
      state = next.state;
      paint();
      applyActions(next.actions);
      scheduleTick();
    });
    term.onResize(paint);
    paint();
    scheduleTick();
    load(generation);
  });
}

export async function runTui(options, view: TuiView = "estimate") {
  const term = attach();
  try {
    await runSession(term, { ...options, includeUsageSeries: options.includeUsageSeries ?? view === "usage" }, view);
  } finally {
    term.detach();
  }
}
