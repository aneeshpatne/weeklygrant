import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const WEEKLY_GRANT_VERSION = "weekly-grant-estimate-v2";
export const MAX_USAGE_SERIES_POINTS = 1_000;
const WEEKLY_MINUTES = 10_080;
const WEEKLY_TOLERANCE = 240;
const FIVE_HOUR_MINUTES = 300;
const FIVE_HOUR_TOLERANCE = 30;
const RESET_JITTER_MS = 2 * 60 * 60 * 1000;
const RESET_DROP_POINTS = 12;
const HARD_RESET_DROP = 25;
const MIN_PERCENT_DELTA = 0.5;
const MIN_WEEK_USD = 1;
const MAX_WEEK_USD = 25_000;
const MEDIAN_SAMPLE_COUNT = 7;
const HISTORY_MIN_COVERAGE = 20;
const HISTORY_MIN_DURATION_MS = 12 * 60 * 60 * 1000;
const LONG_CONTEXT_TOKENS = 272_000;
const READ_CHUNK = 1024 * 1024;
const TYPE_PEEK_BYTES = 256;
const PARSE_LINE_TYPES = new Set(["token_count", "session_meta", "turn_context", "thread_settings_applied", "threadSettings"]);

type RateTier = {
  threshold: number;
  input: number;
  output: number;
  cacheRead: number;
};

type RateCard = {
  input: number;
  output: number;
  cacheRead: number;
  tiers: RateTier[];
  fastMultiplier?: number;
  source?: "official" | "models_dev";
};

type CostLane = {
  times: number[];
  prefix: number[];
};

type CostLanes = {
  unassigned: CostLane;
  byLimit: Map<string, CostLane>;
  includeUnassigned: boolean;
};

type JsonlFile = {
  file: string;
  mtimeMs: number;
  size: number;
};

type ScanDiagnostics = {
  malformedLines: number;
  unreadableFiles: number;
};

export type EstimateOptions = {
  home?: string;
  days?: number;
  refreshPrices?: boolean;
  fetch?: typeof globalThis.fetch | null;
  includeUsageSeries?: boolean;
  includeModelUsage?: boolean;
};

export const OFFICIAL_CARDS: Record<string, RateCard> = {
  "gpt-5": card(1.25, 10, 0.125),
  "gpt-5-codex": card(1.25, 10, 0.125),
  "gpt-5.1": card(1.25, 10, 0.125),
  "gpt-5.1-codex": card(1.25, 10, 0.125),
  "gpt-5.1-codex-mini": card(0.25, 2, 0.025),
  "gpt-5.2": card(1.75, 14, 0.175),
  "gpt-5.2-codex": card(1.75, 14, 0.175),
  "gpt-5.3-codex": card(1.75, 14, 0.175),
  "gpt-5.4": card(2.5, 15, 0.25, tier(5, 22.5, 0.5), 2),
  "gpt-5.4-mini": card(0.75, 4.5, 0.075, null, 2),
  "gpt-5.4-nano": card(0.2, 1.25, 0.02),
  "gpt-5.5": card(5, 30, 0.5, tier(10, 45, 1), 2.5),
  "gpt-5.6": card(4, 20, 0.4, tier(8, 30, 0.8), 2.5),
  "gpt-5.6-sol": card(4, 20, 0.4, tier(8, 30, 0.8), 2.5),
  "gpt-5.6-luna": card(0.2, 1.2, 0.02, tier(0.4, 1.8, 0.04), 2.5),
  "gpt-5.6-terra": card(2, 12, 0.2, tier(4, 18, 0.4), 2.5),
  "gpt-6-astra": card(10, 50, 1, tier(20, 75, 2), 2),
};

const OFFICIAL_FAMILIES = Object.keys(OFFICIAL_CARDS).sort((a, b) => b.length - a.length);
const EMPTY_LANE: CostLane = { times: [], prefix: [0] };

function card(input: number, output: number, cacheRead: number, longTier: RateTier | null = null, fastMultiplier?: number): RateCard {
  return { input, output, cacheRead, tiers: longTier ? [longTier] : [], ...(fastMultiplier ? { fastMultiplier } : {}) };
}

function tier(input: number, output: number, cacheRead: number): RateTier {
  return { threshold: LONG_CONTEXT_TOKENS, input, output, cacheRead };
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function timestampMs(value) {
  if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed < 1e12 ? parsed * 1000 : parsed;
}

export function normalizeModel(model) {
  return String(model || "").trim().toLowerCase().replaceAll("/", "-").replace(/^openai-/, "");
}

function modelFamily(model) {
  const normalized = normalizeModel(model);
  if (OFFICIAL_CARDS[normalized]) return normalized;
  return OFFICIAL_FAMILIES.find((name) => normalized === name || normalized.startsWith(`${name}-`)) || null;
}

function pickCard(model, cards) {
  const normalized = normalizeModel(model);
  if (cards[normalized]) return { rate: cards[normalized], family: modelFamily(normalized) || normalized };
  const family = modelFamily(normalized);
  return { rate: family ? cards[family] || OFFICIAL_CARDS[family] : null, family: family || "" };
}

export function priceTokens(event, cards = OFFICIAL_CARDS) {
  const { rate } = pickCard(event.model, cards);
  if (!rate) return { ...event, costUsd: 0, eligible: false, pricingStatus: "pending" };
  const requestInputTokens = number(event.requestInputTokens, NaN);
  const longContext = Boolean(event.longContext) || (Number.isFinite(requestInputTokens) && requestInputTokens >= LONG_CONTEXT_TOKENS);
  let active = rate;
  if (longContext && rate.tiers.length) {
    let chosen = null;
    for (const candidate of rate.tiers) {
      if (requestInputTokens >= candidate.threshold || event.longContext) chosen = candidate;
    }
    if (chosen) active = chosen;
  }
  if (longContext && !rate.tiers.length) return { ...event, costUsd: 0, eligible: false, pricingStatus: "pending" };
  let costUsd = (
    number(event.uncachedInput) * active.input
    + number(event.cachedInput) * active.cacheRead
    + number(event.billedOutput) * active.output
  ) / 1_000_000;
  if (event.serviceTier === "fast") {
    if (!rate.fastMultiplier) return { ...event, costUsd: 0, eligible: false, pricingStatus: "pending" };
    costUsd *= rate.fastMultiplier;
  }
  return { ...event, costUsd, eligible: true, pricingStatus: active.source || rate.source || "official" };
}

export function summarizeModelUsage(events) {
  const models = new Map();
  for (const event of events) {
    const model = normalizeModel(event.model) || "unknown";
    const existing = models.get(model) || {
      model,
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      apiValueUsd: 0,
      pricedEvents: 0,
      pendingEvents: 0,
    };
    const uncachedInputTokens = number(event.uncachedInput);
    const cachedInputTokens = number(event.cachedInput);
    const outputTokens = number(event.billedOutput);
    existing.uncachedInputTokens += uncachedInputTokens;
    existing.cachedInputTokens += cachedInputTokens;
    existing.outputTokens += outputTokens;
    existing.totalTokens += uncachedInputTokens + cachedInputTokens + outputTokens;
    if (event.eligible) {
      existing.apiValueUsd += number(event.costUsd);
      existing.pricedEvents += 1;
    } else {
      existing.pendingEvents += 1;
    }
    models.set(model, existing);
  }
  return [...models.values()].sort((a, b) => b.apiValueUsd - a.apiValueUsd || b.totalTokens - a.totalTokens || a.model.localeCompare(b.model));
}

export function bucketSeries(points, maxPoints = MAX_USAGE_SERIES_POINTS) {
  if (!points.length || points.length <= maxPoints) return points;
  const start = points[0].timestampMs;
  const span = Math.max(1, points.at(-1).timestampMs - start);
  const buckets = new Array(maxPoints);
  for (const point of points) {
    const index = Math.min(maxPoints - 1, Math.floor((point.timestampMs - start) / span * maxPoints));
    buckets[index] = point;
  }
  return buckets.filter(Boolean);
}

export function buildModelUsageSeries(events, maxPoints = MAX_USAGE_SERIES_POINTS) {
  const totals = new Map();
  const byModel = new Map();
  for (const event of [...events].sort((a, b) => a.timestampMs - b.timestampMs)) {
    const model = normalizeModel(event.model) || "unknown";
    const current = totals.get(model) || { uncachedInputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, apiValueUsd: 0 };
    current.uncachedInputTokens += number(event.uncachedInput);
    current.cachedInputTokens += number(event.cachedInput);
    current.outputTokens += number(event.billedOutput);
    current.totalTokens = current.uncachedInputTokens + current.cachedInputTokens + current.outputTokens;
    if (event.eligible) current.apiValueUsd += number(event.costUsd);
    totals.set(model, current);
    const list = byModel.get(model) || [];
    list.push({ timestampMs: event.timestampMs, model, ...current });
    byModel.set(model, list);
  }
  const series: any[] = [];
  for (const list of byModel.values()) series.push(...bucketSeries(list, maxPoints));
  return series.sort((a, b) => a.timestampMs - b.timestampMs || a.model.localeCompare(b.model));
}

function quotaObservations(rateLimits, timestamp, sessionId) {
  if (!rateLimits || typeof rateLimits !== "object") return { weekly: null, fiveHour: null };
  const windows = [rateLimits.primary, rateLimits.secondary].filter(Boolean).map((window) => ({
    window,
    minutes: number(window.window_minutes ?? window.windowMinutes, NaN),
  }));
  const pick = (target: number, tolerance: number, windowKind: "weekly" | "five_hour") => {
    const candidate = windows
      .map(({ window, minutes }) => ({ window, minutes, distance: Math.abs(minutes - target) }))
      .filter(({ distance }) => distance <= tolerance)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!candidate) return null;
    return {
      timestampMs: timestamp,
      usedPercent: number(candidate.window.used_percent ?? candidate.window.usedPercent, NaN),
      resetsAtMs: timestampMs(candidate.window.resets_at ?? candidate.window.resetsAt),
      limitId: String(rateLimits.limit_id ?? rateLimits.limitId ?? "codex"),
      planType: rateLimits.plan_type ?? rateLimits.planType ?? null,
      accountKey: "local",
      sessionId,
      windowKind,
      windowMinutes: candidate.minutes,
    };
  };
  return {
    weekly: pick(WEEKLY_MINUTES, WEEKLY_TOLERANCE, "weekly"),
    fiveHour: pick(FIVE_HOUR_MINUTES, FIVE_HOUR_TOLERANCE, "five_hour"),
  };
}

function typeFromPrefix(head: string) {
  let from = 0;
  let first: string | null = null;
  while (from < head.length) {
    const key = head.indexOf('"type"', from);
    if (key < 0) break;
    let index = key + 6;
    while (index < head.length && (head[index] === " " || head[index] === "\t")) index++;
    if (head[index] !== ":") {
      from = key + 1;
      continue;
    }
    index++;
    while (index < head.length && (head[index] === " " || head[index] === "\t")) index++;
    if (head[index] !== '"') {
      from = key + 1;
      continue;
    }
    index++;
    const end = head.indexOf('"', index);
    if (end < 0) break;
    const value = head.slice(index, end);
    if (first == null) {
      if (value !== "event_msg") return value;
      first = value;
    } else return value;
    from = end + 1;
  }
  return first;
}

function shouldParseLine(head: string) {
  const type = typeFromPrefix(head);
  return !type || type === "event_msg" || PARSE_LINE_TYPES.has(type);
}

function prefixOf(parts: Buffer[]) {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].toString("latin1", 0, Math.min(TYPE_PEEK_BYTES, parts[0].length));
  return Buffer.concat(parts).toString("latin1", 0, TYPE_PEEK_BYTES);
}

function decodeParts(parts: Buffer[]) {
  return parts.length === 1 ? parts[0].toString("utf8") : Buffer.concat(parts).toString("utf8");
}

function stripTrailingCr(parts: Buffer[]) {
  const last = parts.at(-1);
  if (!last?.length || last[last.length - 1] !== 13) return;
  parts[parts.length - 1] = last.subarray(0, last.length - 1);
}

function* readCandidateLines(file: string) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(READ_CHUNK);
    let mode = "peek";
    let parts: Buffer[] = [];
    let peekBytes = 0;
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      const chunk = buf.subarray(0, n); // indexOf must not see allocUnsafe tail bytes
      let offset = 0;
      while (offset < n) {
        if (mode === "skip") {
          const nl = chunk.indexOf(10, offset);
          if (nl < 0) break;
          offset = nl + 1;
          mode = "peek";
          continue;
        }
        const nl = chunk.indexOf(10, offset);
        if (nl < 0) {
          const slice = Buffer.from(chunk.subarray(offset));
          parts.push(slice);
          peekBytes += slice.length;
          if (mode === "peek" && peekBytes >= TYPE_PEEK_BYTES) {
            if (shouldParseLine(prefixOf(parts))) mode = "keep";
            else {
              mode = "skip";
              parts = [];
              peekBytes = 0;
            }
          }
          break;
        }
        const lineEnd = nl > offset && chunk[nl - 1] === 13 ? nl - 1 : nl;
        if (nl === offset) stripTrailingCr(parts);
        if (mode === "keep") {
          if (nl > offset) parts.push(Buffer.from(chunk.subarray(offset, lineEnd)));
          yield decodeParts(parts);
        } else if (parts.length) {
          if (nl > offset) parts.push(Buffer.from(chunk.subarray(offset, lineEnd)));
          if (shouldParseLine(prefixOf(parts))) yield decodeParts(parts);
        } else if (lineEnd > offset && shouldParseLine(chunk.toString("latin1", offset, Math.min(offset + TYPE_PEEK_BYTES, lineEnd)))) {
          yield chunk.toString("utf8", offset, lineEnd);
        }
        parts = [];
        peekBytes = 0;
        mode = "peek";
        offset = nl + 1;
      }
    }
    if (mode === "keep" || (mode === "peek" && parts.length && shouldParseLine(prefixOf(parts)))) yield decodeParts(parts);
  } finally {
    fs.closeSync(fd);
  }
}

export function parseLogFile(file, mtimeMs?: number, size?: number) {
  let fileMtime = mtimeMs;
  let fileSize = size;
  if (fileMtime == null || fileSize == null) {
    const stat = fs.statSync(file);
    fileMtime = stat.mtimeMs;
    fileSize = stat.size;
  }
  let sessionId = path.basename(file, ".jsonl");
  let model = "";
  let serviceTier = "standard";
  let lastLimitId: string | null = null;
  let previous = { uncachedInput: 0, cachedInput: 0, billedOutput: 0, reasoning: 0 };
  const events: any[] = [];
  const observations: any[] = [];
  const fiveHourObservations: any[] = [];
  let malformedLines = 0;
  if (!fileSize) return { events, observations, fiveHourObservations, malformedLines };
  for (const line of readCandidateLines(file)) {
    if (!line.trim()) continue;
    let object;
    try { object = JSON.parse(line); } catch { malformedLines += 1; continue; }
    const payload = object.payload && typeof object.payload === "object" ? object.payload : object;
    const type = object.type === "event_msg" ? payload.type : object.type;
    if (type === "session_meta") {
      sessionId = String(payload.id ?? payload.session_id ?? object.id ?? object.session_id ?? sessionId);
      continue;
    }
    if (type === "turn_context" || type === "thread_settings_applied" || type === "threadSettings") {
      model = payload.model ?? payload.model_id ?? object.model ?? model;
      const rawTier = String(payload.service_tier ?? payload.serviceTier ?? object.service_tier ?? "").toLowerCase();
      if (rawTier === "priority" || rawTier === "fast") serviceTier = "fast";
      else if (rawTier === "default" || rawTier === "standard") serviceTier = "standard";
      continue;
    }
    if (type !== "token_count") continue;
    const at = timestampMs(object.timestamp ?? payload.timestamp) ?? fileMtime;
    const info = payload.info ?? object.info ?? {};
    const usage = info.total_token_usage ?? info.totalTokenUsage ?? payload.total_token_usage ?? {};
    const lastUsage = info.last_token_usage ?? info.lastTokenUsage ?? payload.last_token_usage ?? null;
    const input = number(usage.input_tokens ?? usage.inputTokens);
    const cached = number(usage.cached_input_tokens ?? usage.cachedInputTokens);
    const output = number(usage.output_tokens ?? usage.outputTokens);
    const reasoning = number(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens);
    const current = {
      uncachedInput: Math.max(0, input - cached),
      cachedInput: Math.max(0, cached),
      billedOutput: Math.max(0, output > 0 ? output : reasoning),
      reasoning: Math.max(0, reasoning),
    };
    let delta = {
      uncachedInput: Math.max(0, current.uncachedInput - previous.uncachedInput),
      cachedInput: Math.max(0, current.cachedInput - previous.cachedInput),
      billedOutput: Math.max(0, current.billedOutput - previous.billedOutput),
      reasoning: Math.max(0, current.reasoning - previous.reasoning),
    };
    const currentTotal = current.uncachedInput + current.cachedInput + current.billedOutput;
    const previousTotal = previous.uncachedInput + previous.cachedInput + previous.billedOutput;
    const counterReset = currentTotal < previousTotal;
    if (counterReset) {
      const lastInput = number(lastUsage?.input_tokens ?? lastUsage?.inputTokens, NaN);
      const lastCached = number(lastUsage?.cached_input_tokens ?? lastUsage?.cachedInputTokens, NaN);
      const lastOutput = number(lastUsage?.output_tokens ?? lastUsage?.outputTokens, NaN);
      const lastReasoning = number(lastUsage?.reasoning_output_tokens ?? lastUsage?.reasoningOutputTokens);
      if (Number.isFinite(lastInput) && Number.isFinite(lastCached) && Number.isFinite(lastOutput)) {
        delta = {
          uncachedInput: Math.max(0, lastInput - lastCached),
          cachedInput: Math.max(0, lastCached),
          billedOutput: Math.max(0, lastOutput > 0 ? lastOutput : lastReasoning),
          reasoning: Math.max(0, lastReasoning),
        };
      } else delta = current;
    }
    previous = current;
    const rateLimits = payload.rate_limits ?? payload.rateLimits ?? object.rate_limits ?? object.rateLimits;
    const quota = quotaObservations(rateLimits, at, sessionId);
    if (quota.weekly) observations.push(quota.weekly);
    if (quota.fiveHour) fiveHourObservations.push(quota.fiveHour);
    const observation = quota.weekly ?? quota.fiveHour;
    if (observation) {
      lastLimitId = observation.limitId;
    }
    if (delta.uncachedInput + delta.cachedInput + delta.billedOutput > 0) {
      const requestInput = number(lastUsage?.input_tokens ?? lastUsage?.inputTokens, NaN);
      events.push({
        ...delta,
        timestampMs: at,
        model,
        serviceTier,
        sessionId,
        quotaLimitId: observation?.limitId ?? lastLimitId,
        requestInputTokens: Number.isFinite(requestInput) ? requestInput : delta.uncachedInput + delta.cachedInput,
        counterReset,
      });
    }
  }
  return { events, observations, fiveHourObservations, malformedLines };
}

function walkJsonl(root, cutoff, output: JsonlFile[] = [], diagnostics: ScanDiagnostics = { malformedLines: 0, unreadableFiles: 0 }) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error && (error as NodeJS.ErrnoException).code === "ENOENT") return output;
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) walkJsonl(target, cutoff, output, diagnostics);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      let stat;
      try { stat = fs.statSync(target); } catch { diagnostics.unreadableFiles += 1; continue; }
      if (stat.mtimeMs >= cutoff) output.push({ file: target, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
  return output;
}

export function collapseObservations(observations) {
  const grouped = new Map();
  for (const item of observations) {
    if (!Number.isFinite(item.usedPercent) || item.usedPercent < 0 || item.usedPercent > 100) continue;
    const key = `${item.accountKey}:${item.limitId}:${Math.floor(item.timestampMs / 1000)}`;
    const existing = grouped.get(key);
    if (!existing || item.timestampMs > existing.timestampMs || (item.timestampMs === existing.timestampMs && item.usedPercent > existing.usedPercent)) grouped.set(key, item);
  }
  return [...grouped.values()].sort((a, b) => a.timestampMs - b.timestampMs);
}

export function splitEpochs(observations) {
  const groups = new Map();
  for (const item of observations) {
    const key = `${item.accountKey}:${item.limitId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const epochs: any[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.timestampMs - b.timestampMs);
    let epoch: any[] = [];
    for (const original of group) {
      const previous = epoch.at(-1);
      const drop = previous ? previous.usedPercent - original.usedPercent : 0;
      const resetJump = Boolean(previous?.resetsAtMs && original.resetsAtMs && original.resetsAtMs - previous.resetsAtMs > RESET_JITTER_MS);
      const afterReset = previous?.resetsAtMs && original.timestampMs >= previous.resetsAtMs - RESET_JITTER_MS;
      const planChanged = Boolean(previous?.planType && original.planType && previous.planType !== original.planType);
      const reset = planChanged
        || drop >= HARD_RESET_DROP
        || (resetJump && (afterReset || drop > 0))
        || (drop >= RESET_DROP_POINTS && (resetJump || afterReset));
      if (reset && epoch.length) { epochs.push(epoch); epoch = []; }
      const item = !reset && previous && original.usedPercent < previous.usedPercent
        ? { ...original, usedPercent: previous.usedPercent }
        : original;
      epoch.push(item);
    }
    if (epoch.length) epochs.push(epoch);
  }
  return epochs.sort((a, b) => a[0].timestampMs - b[0].timestampMs);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function weightedMedian(rates) {
  if (!rates.length) return null;
  const sorted = [...rates].sort((a, b) => a.value - b.value);
  const halfway = sorted.reduce((sum, rate) => sum + rate.weight, 0) / 2;
  let total = 0;
  for (const rate of sorted) { total += rate.weight; if (total >= halfway) return rate.value; }
  return sorted.at(-1).value;
}

function pooledWeekUsd(costUsd, percent) {
  if (!(costUsd > 0) || !(percent > 0)) return null;
  const value = costUsd / (percent / 100);
  if (!Number.isFinite(value) || value < MIN_WEEK_USD || value > MAX_WEEK_USD) return null;
  return value;
}

function classifyConfidence(validPairs, coverage, rates) {
  if (validPairs < 1) return "none";
  const recent = rates.filter((x) => x > 0).slice(-MEDIAN_SAMPLE_COUNT);
  const center = median(recent);
  const relative = center ? median(recent.map((x) => Math.abs(x - center))) / center : Infinity;
  if (validPairs >= 5 && coverage >= 20 && relative <= 0.1) return "high";
  if (validPairs >= 2 && coverage >= 5 && relative <= 0.25) return "medium";
  return "low";
}

export function isStableEstimate(confidence) {
  return confidence === "medium" || confidence === "high";
}

function percentDelta(current, baseline) {
  if (!(current > 0) || !(baseline > 0)) return null;
  return (current - baseline) / baseline * 100;
}

export function summarizeGrantHistory(epochFits, currentHeadlineUsd: number | null = null) {
  const comparable = epochFits.filter((epoch) => (
    epoch.headlineUsd > 0
    && isStableEstimate(epoch.confidence)
    && epoch.coveragePoints >= HISTORY_MIN_COVERAGE
    && epoch.endMs - epoch.startMs >= HISTORY_MIN_DURATION_MS
  ));
  if (comparable.length < 2) {
    return { peakUsd: null, averageUsd: null, comparableWeeks: comparable.length, vsPeakPercent: null, vsAveragePercent: null };
  }
  const values = comparable.map((epoch) => epoch.headlineUsd);
  const peakUsd = Math.max(...values);
  const averageUsd = values.reduce((total, value) => total + value, 0) / values.length;
  return {
    peakUsd,
    averageUsd,
    comparableWeeks: comparable.length,
    vsPeakPercent: percentDelta(currentHeadlineUsd, peakUsd),
    vsAveragePercent: percentDelta(currentHeadlineUsd, averageUsd),
  };
}

export function hasGraphableSeries(series, minPoints = 2) {
  if (!Array.isArray(series) || series.length < minPoints) return false;
  return ["valueUsd", "usedPercent", "observedCostUsd"].some(
    (field) => series.filter((point) => Number.isFinite(Number(point[field]))).length >= minPoints,
  );
}

function buildLane(events): CostLane {
  const sorted = [...events].sort((a, b) => a.timestampMs - b.timestampMs);
  const times: number[] = [];
  const prefix = [0];
  let sum = 0;
  for (const event of sorted) {
    const cost = number(event.costUsd);
    if (!cost) continue;
    sum += cost;
    times.push(event.timestampMs);
    prefix.push(sum);
  }
  return { times, prefix };
}

export function buildCostLanes(events): CostLanes {
  const unassigned: any[] = [];
  const byLimit = new Map();
  for (const event of events) {
    if (!event.eligible) continue;
    if (event.quotaLimitId) {
      const list = byLimit.get(event.quotaLimitId) || [];
      list.push(event);
      byLimit.set(event.quotaLimitId, list);
    } else unassigned.push(event);
  }
  const lanes: CostLanes = { unassigned: buildLane(unassigned), byLimit: new Map(), includeUnassigned: byLimit.size <= 1 };
  for (const [limitId, list] of byLimit) lanes.byLimit.set(limitId, buildLane(list));
  return lanes;
}

function costAt(lane: CostLane, timestamp: number) {
  const times = lane.times;
  if (!times.length || timestamp < times[0]) return 0;
  let lo = 0;
  let hi = times.length - 1;
  let index = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= timestamp) {
      index = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return index < 0 ? 0 : lane.prefix[index + 1];
}

export function costInWindow(lanes: CostLanes, start: number, end: number, limitId: string) {
  const tagged = lanes.byLimit.get(limitId) || EMPTY_LANE;
  const assigned = costAt(tagged, end) - costAt(tagged, start);
  return lanes.includeUnassigned ? assigned + costAt(lanes.unassigned, end) - costAt(lanes.unassigned, start) : assigned;
}

export function estimateGrantFromLogs(events, observations) {
  const collapsed = collapseObservations(observations);
  const epochs = splitEpochs(collapsed);
  const lanes = buildCostLanes(events);
  const series: any[] = [];
  const epochFits: any[] = [];
  let active: any = null;
  let pricedEvents = 0;
  let pendingEvents = 0;
  for (const event of events) {
    if (event.eligible) pricedEvents += 1;
    else pendingEvents += 1;
  }
  epochs.forEach((epoch, epochIndex) => {
    const first = epoch[0];
    let anchor = first;
    let anchorCost = costInWindow(lanes, first.timestampMs, anchor.timestampMs, first.limitId);
    const candidates: any[] = [];
    const timeline: any[] = [];
    for (let index = 1; index < epoch.length; index++) {
      const current = epoch[index];
      const currentCost = costInWindow(lanes, first.timestampMs, current.timestampMs, first.limitId);
      const costDelta = currentCost - anchorCost;
      const percentDelta = current.usedPercent - anchor.usedPercent;
      let decision = "pending";
      let weekUsd: number | null = null;
      if (![costDelta, percentDelta].every(Number.isFinite) || percentDelta < -0.01) decision = "rejected";
      else if (costDelta > 0 && percentDelta >= MIN_PERCENT_DELTA) {
        weekUsd = costDelta / (percentDelta / 100);
        if (!Number.isFinite(weekUsd) || weekUsd <= 0 || weekUsd < MIN_WEEK_USD) decision = "rejected";
        else if (weekUsd > MAX_WEEK_USD) decision = "pending";
        else decision = "valid";
      }
      if (decision === "valid") {
        const candidate = { current, currentCost, costDelta, percentDelta, weekUsd };
        candidates.push(candidate);
        timeline.push(candidate);
        anchor = current;
        anchorCost = currentCost;
      } else {
        const unmatchedJump = costDelta <= 0 && percentDelta >= MIN_PERCENT_DELTA;
        if (decision === "rejected" || unmatchedJump) { anchor = current; anchorCost = currentCost; }
        timeline.push({ current, currentCost });
      }
    }
    const weightedRates = candidates.map((candidate) => ({ value: candidate.weekUsd, weight: Math.max(0.5, candidate.percentDelta) }));
    const center = weightedMedian(weightedRates);
    const mad = center == null ? null : weightedMedian(weightedRates.map((rate) => ({ value: Math.abs(rate.value - center), weight: rate.weight })));
    const threshold = center == null ? Infinity : Math.max(center * 0.25, 3 * (mad ?? 0));
    const inliers = new Set(candidates.length < 3 || center == null
      ? candidates
      : candidates.filter((candidate) => Math.abs(candidate.weekUsd - center) <= threshold));
    let matchedCost = 0;
    let matchedPercent = 0;
    let previous: any = null;
    const inlierRates: number[] = [];
    for (const point of timeline) {
      if (point.weekUsd != null && inliers.has(point)) {
        matchedCost += point.costDelta;
        matchedPercent += point.percentDelta;
        inlierRates.push(point.weekUsd);
        const fitted = pooledWeekUsd(matchedCost, matchedPercent) ?? point.weekUsd;
        previous = { timestampMs: point.current.timestampMs, epoch: epochIndex, kind: "quote", valueUsd: fitted, rawUsd: point.weekUsd, usedPercent: point.current.usedPercent, observedCostUsd: point.currentCost, resetsAtMs: point.current.resetsAtMs };
        series.push(previous);
      } else if (previous) {
        previous = { ...previous, timestampMs: point.current.timestampMs, epoch: epochIndex, kind: "heartbeat", usedPercent: point.current.usedPercent, observedCostUsd: point.currentCost, resetsAtMs: point.current.resetsAtMs };
        series.push(previous);
      }
    }
    const rawUsd = inlierRates.at(-1) ?? null;
    const coveragePoints = Math.max(0, epoch.at(-1).usedPercent - first.usedPercent);
    const headlineUsd = pooledWeekUsd(matchedCost, matchedPercent) ?? rawUsd;
    epochFits.push({
      headlineUsd,
      confidence: classifyConfidence(inlierRates.length, matchedPercent, inlierRates),
      coveragePoints,
      startMs: first.timestampMs,
      endMs: epoch.at(-1).timestampMs,
    });
    active = {
      epoch, rawUsd, validPairs: inlierRates.length, inlierRates,
      headlineUsd,
      coveragePoints,
      matchedCoveragePoints: matchedPercent,
      observedTokenCostUsd: costInWindow(lanes, first.timestampMs, Date.now(), first.limitId),
      outlierPairs: candidates.length - inlierRates.length,
    };
  });
  const latest = active?.epoch.at(-1) ?? null;
  const confidence = classifyConfidence(active?.validPairs ?? 0, active?.matchedCoveragePoints ?? 0, active?.inlierRates ?? []);
  return {
    algorithm: WEEKLY_GRANT_VERSION,
    headlineUsd: active?.headlineUsd ?? null,
    rawUsd: active?.rawUsd ?? null,
    history: summarizeGrantHistory(epochFits, active?.headlineUsd ?? null),
    confidence,
    label: confidence === "medium" || confidence === "high" ? "Stable Weekly API Value" : "Early Weekly API Value",
    coveragePoints: active?.coveragePoints ?? 0,
    matchedCoveragePoints: active?.matchedCoveragePoints ?? 0,
    weeklyUsedPercent: latest?.usedPercent ?? null,
    observedTokenCostUsd: active?.observedTokenCostUsd ?? 0,
    validPairs: active?.validPairs ?? 0,
    outlierPairs: active?.outlierPairs ?? 0,
    pricedEvents,
    pendingEvents,
    resetsAtMs: latest?.resetsAtMs ?? null,
    planType: latest?.planType ?? null,
    series: bucketSeries(series, MAX_USAGE_SERIES_POINTS),
  };
}

function parseModelsDev(data: any): Record<string, RateCard> {
  const models = data?.openai?.models;
  if (!models || typeof models !== "object") return {};
  const cards: Record<string, RateCard> = {};
  for (const [id, value] of Object.entries(models) as Array<[string, any]>) {
    const cost = value?.cost;
    const input = number(cost?.input, NaN);
    const output = number(cost?.output, NaN);
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    const next = card(input, output, number(cost?.cache_read ?? cost?.cacheRead, input));
    next.source = "models_dev";
    cards[normalizeModel(id)] = next;
  }
  return cards;
}

export async function loadRateCards(fetchImpl: typeof globalThis.fetch | null = null): Promise<Record<string, RateCard>> {
  const official: Record<string, RateCard> = Object.fromEntries(Object.entries(OFFICIAL_CARDS).map(([id, value]) => [id, { ...value, source: "official" }]));
  if (!fetchImpl) return official;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetchImpl("https://models.dev/api.json", { signal: controller.signal });
    if (!response.ok) return official;
    const refreshed = parseModelsDev(await response.json());
    for (const [id, value] of Object.entries(refreshed)) if (!official[id]) official[id] = value;
    return official;
  } catch { return official; }
  finally { clearTimeout(timeout); }
}

export async function estimateCodexGrant(options: EstimateOptions = {}) {
  const home = path.resolve(options.home || String(process.env.CODEX_HOME || "").split(",")[0] || path.join(os.homedir(), ".codex"));
  const cardsPromise = loadRateCards(options.refreshPrices ? options.fetch ?? globalThis.fetch : null);
  const cutoff = Number.isFinite(options.days) ? Date.now() - Number(options.days) * 86_400_000 : -Infinity;
  const diagnostics: ScanDiagnostics = { malformedLines: 0, unreadableFiles: 0 };
  const files = [...walkJsonl(path.join(home, "sessions"), cutoff, [], diagnostics), ...walkJsonl(path.join(home, "archived_sessions"), cutoff, [], diagnostics)];
  const parsed = files.map((entry) => parseLogFile(entry.file, entry.mtimeMs, entry.size));
  diagnostics.malformedLines = parsed.reduce((total, item) => total + item.malformedLines, 0);
  const cards = await cardsPromise;
  const events = parsed.flatMap((item) => item.events).map((event) => priceTokens(event, cards));
  const report = estimateGrantFromLogs(events, parsed.flatMap((item) => item.observations));
  const fiveHourObservations = parsed.flatMap((item) => item.fiveHourObservations);
  const fiveHourEstimate = fiveHourObservations.length ? estimateGrantFromLogs(events, fiveHourObservations) : null;
  const fiveHour = fiveHourEstimate ? {
    present: true,
    windowMinutes: FIVE_HOUR_MINUTES,
    headlineUsd: fiveHourEstimate.headlineUsd,
    rawUsd: fiveHourEstimate.rawUsd,
    confidence: fiveHourEstimate.confidence,
    usedPercent: fiveHourEstimate.weeklyUsedPercent,
    resetsAtMs: fiveHourEstimate.resetsAtMs,
    validPairs: fiveHourEstimate.validPairs,
    coveragePoints: fiveHourEstimate.coveragePoints,
    matchedCoveragePoints: fiveHourEstimate.matchedCoveragePoints,
    series: fiveHourEstimate.series,
    maxSpendPercentOfWeekly: fiveHourEstimate.headlineUsd != null && report.headlineUsd != null && report.headlineUsd > 0
      ? fiveHourEstimate.headlineUsd / report.headlineUsd * 100
      : null,
  } : { present: false };
  const pricingSources = [...new Set(events.filter((event) => event.eligible).map((event) => event.pricingStatus))].sort();
  return {
    ...report,
    fiveHour,
    pricingSources,
    rateCardMode: options.refreshPrices ? "bundled-plus-models-dev" : "bundled-official",
    codexHome: home,
    filesScanned: files.length,
    diagnostics,
    scanWindowDays: Number.isFinite(options.days) ? options.days : null,
    modelUsage: options.includeModelUsage || options.includeUsageSeries ? summarizeModelUsage(events) : [],
    modelUsageSeries: options.includeUsageSeries ? buildModelUsageSeries(events) : [],
  };
}
