import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const WEEKLY_GRANT_VERSION = "weekly-grant-estimate";
const WEEKLY_MINUTES = 10_080;
const WEEKLY_TOLERANCE = 240;
const RESET_JITTER_MS = 2 * 60 * 60 * 1000;
const RESET_DROP_POINTS = 12;
const HARD_RESET_DROP = 25;
const MIN_PERCENT_DELTA = 0.5;
const MIN_WEEK_USD = 1;
const MAX_WEEK_USD = 25_000;
const MEDIAN_SAMPLE_COUNT = 7;
const ESTIMATE_SAMPLE_COUNT = 12;
const LONG_CONTEXT_TOKENS = 272_000;

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
  source?: "official" | "models_dev";
};

export type EstimateOptions = {
  home?: string;
  days?: number;
  noNetwork?: boolean;
  fetch?: typeof globalThis.fetch | null;
};

export const FALLBACK_CARDS: Record<string, RateCard> = {
  "gpt-5": card(1.25, 10, 0.125),
  "gpt-5-codex": card(1.25, 10, 0.125),
  "gpt-5.1": card(1.25, 10, 0.125),
  "gpt-5.1-codex": card(1.25, 10, 0.125),
  "gpt-5.1-codex-mini": card(0.25, 2, 0.025),
  "gpt-5.2": card(1.75, 14, 0.175),
  "gpt-5.2-codex": card(1.75, 14, 0.175),
  "gpt-5.3-codex": card(1.75, 14, 0.175),
  "gpt-5.4": card(2.5, 15, 0.25, tier(5, 22.5, 0.5)),
  "gpt-5.4-mini": card(0.75, 4.5, 0.075),
  "gpt-5.4-nano": card(0.2, 1.25, 0.02),
  "gpt-5.5": card(5, 30, 0.5, tier(10, 45, 1)),
  "gpt-5.6": card(5, 30, 0.5, tier(10, 45, 1)),
  "gpt-5.6-sol": card(5, 30, 0.5, tier(10, 45, 1)),
  "gpt-5.6-luna": card(0.2, 1.2, 0.02, tier(0.4, 1.8, 0.04)),
  "gpt-5.6-terra": card(2, 12, 0.2, tier(4, 18, 0.4)),
};

function card(input: number, output: number, cacheRead: number, longTier: RateTier | null = null): RateCard {
  return { input, output, cacheRead, tiers: longTier ? [longTier] : [] };
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
  if (FALLBACK_CARDS[normalized]) return normalized;
  const candidates = Object.keys(FALLBACK_CARDS).sort((a, b) => b.length - a.length);
  return candidates.find((name) => normalized === name || normalized.startsWith(`${name}-`)) || null;
}

function pickCard(model, cards) {
  const normalized = normalizeModel(model);
  if (cards[normalized]) return cards[normalized];
  const family = modelFamily(normalized);
  return family ? cards[family] || FALLBACK_CARDS[family] : null;
}

export function priceTokens(event, cards = FALLBACK_CARDS) {
  const rate = pickCard(event.model, cards);
  if (!rate) return { ...event, costUsd: 0, eligible: false, pricingStatus: "pending" };
  const inputTokens = number(event.uncachedInput) + number(event.cachedInput);
  const longContext = Boolean(event.longContext) || inputTokens > LONG_CONTEXT_TOKENS;
  let active = rate;
  if (longContext && rate.tiers?.length) {
    active = [...rate.tiers].sort((a, b) => a.threshold - b.threshold)
      .filter((candidate) => inputTokens > candidate.threshold || event.longContext).at(-1) || rate;
  }
  let inputMult = 1;
  let outputMult = 1;
  const family = modelFamily(event.model) || "";
  if (longContext && !rate.tiers?.length && /gpt-5\.[456]/.test(family)) {
    inputMult = 2;
    outputMult = 1.5;
  }
  let costUsd = (
    number(event.uncachedInput) * active.input * inputMult
    + number(event.cachedInput) * active.cacheRead
    + number(event.billedOutput) * active.output * outputMult
  ) / 1_000_000;
  if (event.serviceTier === "fast") costUsd *= family.includes("gpt-5.4") ? 2 : 2.5;
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

export function buildModelUsageSeries(events) {
  const totals = new Map();
  return [...events].sort((a, b) => a.timestampMs - b.timestampMs).map((event) => {
    const model = normalizeModel(event.model) || "unknown";
    const current = totals.get(model) || { uncachedInputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, apiValueUsd: 0 };
    current.uncachedInputTokens += number(event.uncachedInput);
    current.cachedInputTokens += number(event.cachedInput);
    current.outputTokens += number(event.billedOutput);
    current.totalTokens = current.uncachedInputTokens + current.cachedInputTokens + current.outputTokens;
    if (event.eligible) current.apiValueUsd += number(event.costUsd);
    totals.set(model, current);
    return { timestampMs: event.timestampMs, model, ...current };
  });
}

function weeklyObservation(rateLimits, timestamp, sessionId) {
  if (!rateLimits || typeof rateLimits !== "object") return null;
  const candidates = [rateLimits.primary, rateLimits.secondary].filter(Boolean)
    .map((window) => ({ window, distance: Math.abs(number(window.window_minutes ?? window.windowMinutes, Infinity) - WEEKLY_MINUTES) }))
    .filter(({ distance }) => distance <= WEEKLY_TOLERANCE)
    .sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return null;
  const window = candidates[0].window;
  return {
    timestampMs: timestamp,
    usedPercent: number(window.used_percent ?? window.usedPercent, NaN),
    resetsAtMs: timestampMs(window.resets_at ?? window.resetsAt),
    limitId: String(rateLimits.limit_id ?? rateLimits.limitId ?? "codex"),
    planType: rateLimits.plan_type ?? rateLimits.planType ?? null,
    accountKey: "local",
    sessionId,
  };
}

export function parseLogFile(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let sessionId = path.basename(file, ".jsonl");
  let model = "";
  let serviceTier = "standard";
  let previous = { uncachedInput: 0, cachedInput: 0, billedOutput: 0, reasoning: 0 };
  const events = [];
  const observations = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let object;
    try { object = JSON.parse(line); } catch { continue; }
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
    const at = timestampMs(object.timestamp ?? payload.timestamp) ?? fs.statSync(file).mtimeMs;
    const info = payload.info ?? object.info ?? {};
    const usage = info.total_token_usage ?? info.totalTokenUsage ?? payload.total_token_usage ?? {};
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
    const delta = {
      uncachedInput: Math.max(0, current.uncachedInput - previous.uncachedInput),
      cachedInput: Math.max(0, current.cachedInput - previous.cachedInput),
      billedOutput: Math.max(0, current.billedOutput - previous.billedOutput),
      reasoning: Math.max(0, current.reasoning - previous.reasoning),
    };
    previous = current;
    const rateLimits = payload.rate_limits ?? payload.rateLimits ?? object.rate_limits ?? object.rateLimits;
    const observation = weeklyObservation(rateLimits, at, sessionId);
    if (observation) observations.push(observation);
    if (delta.uncachedInput + delta.cachedInput + delta.billedOutput > 0) {
      events.push({ ...delta, timestampMs: at, model, serviceTier, sessionId, quotaLimitId: observation?.limitId ?? null });
    }
  }
  return { events, observations };
}

function walkJsonl(root, cutoff, output = []) {
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) walkJsonl(target, cutoff, output);
    else if (entry.isFile() && entry.name.endsWith(".jsonl") && fs.statSync(target).mtimeMs >= cutoff) output.push(target);
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
  const epochs = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.timestampMs - b.timestampMs);
    let epoch = [];
    for (const original of group) {
      const previous = epoch.at(-1);
      const drop = previous ? previous.usedPercent - original.usedPercent : 0;
      const resetJump = previous?.resetsAtMs && original.resetsAtMs && original.resetsAtMs - previous.resetsAtMs > RESET_JITTER_MS;
      const afterReset = previous?.resetsAtMs && original.timestampMs >= previous.resetsAtMs - RESET_JITTER_MS;
      const reset = drop >= HARD_RESET_DROP || (drop >= RESET_DROP_POINTS && (resetJump || afterReset));
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

function classifyConfidence(validPairs, coverage, fitted) {
  if (validPairs < 1) return "none";
  const recent = fitted.filter((x) => x > 0).slice(-MEDIAN_SAMPLE_COUNT);
  const center = median(recent);
  const relative = center ? median(recent.map((x) => Math.abs(x - center))) / center : Infinity;
  if (validPairs >= 5 && coverage >= 20 && relative <= 0.1) return "high";
  if (validPairs >= 2 && coverage >= 5 && relative <= 0.25) return "medium";
  return "low";
}

function costInWindow(events, start, end, limitId) {
  return events.reduce((sum, event) => sum + (event.eligible && event.timestampMs > start && event.timestampMs <= end
    && (!event.quotaLimitId || event.quotaLimitId === limitId) ? event.costUsd : 0), 0);
}

export function estimateGrantFromLogs(events, observations) {
  const collapsed = collapseObservations(observations);
  const epochs = splitEpochs(collapsed);
  const series = [];
  let active = null;
  epochs.forEach((epoch, epochIndex) => {
    const first = epoch[0];
    let anchor = first;
    let anchorCost = costInWindow(events, first.timestampMs, anchor.timestampMs, first.limitId);
    const rates = [];
    const fittedValues = [];
    let rawUsd = null;
    for (const current of epoch.slice(1)) {
      const currentCost = costInWindow(events, first.timestampMs, current.timestampMs, first.limitId);
      const costDelta = currentCost - anchorCost;
      const percentDelta = current.usedPercent - anchor.usedPercent;
      let decision = "pending";
      let weekUsd = null;
      if (![costDelta, percentDelta].every(Number.isFinite) || percentDelta < -0.01) decision = "rejected";
      else if (costDelta > 0 && percentDelta >= MIN_PERCENT_DELTA) {
        weekUsd = costDelta / (percentDelta / 100);
        if (!Number.isFinite(weekUsd) || weekUsd <= 0 || weekUsd < MIN_WEEK_USD) decision = "rejected";
        else if (weekUsd > MAX_WEEK_USD) decision = "pending";
        else decision = "valid";
      }
      if (decision === "valid") {
        rates.push({ value: weekUsd, weight: Math.max(0.5, percentDelta) });
        rawUsd = weekUsd;
        const fitted = weightedMedian(rates.slice(-ESTIMATE_SAMPLE_COUNT)) ?? weekUsd;
        fittedValues.push(fitted);
        series.push({ timestampMs: current.timestampMs, epoch: epochIndex, kind: "quote", valueUsd: fitted, rawUsd: weekUsd, usedPercent: current.usedPercent, observedCostUsd: currentCost });
        anchor = current;
        anchorCost = currentCost;
      } else {
        const unmatchedJump = costDelta <= 0 && percentDelta >= MIN_PERCENT_DELTA;
        if (decision === "rejected" || unmatchedJump) { anchor = current; anchorCost = currentCost; }
        const previous = series.findLast((point) => point.epoch === epochIndex);
        if (previous) series.push({ ...previous, timestampMs: current.timestampMs, epoch: epochIndex, kind: "heartbeat", usedPercent: current.usedPercent, observedCostUsd: currentCost });
      }
    }
    active = {
      epoch, rates, fittedValues, rawUsd, validPairs: rates.length,
      headlineUsd: weightedMedian(rates.slice(-ESTIMATE_SAMPLE_COUNT)) ?? rawUsd,
      coveragePoints: Math.max(0, epoch.at(-1).usedPercent - first.usedPercent),
      observedTokenCostUsd: costInWindow(events, first.timestampMs, Date.now(), first.limitId),
    };
  });
  const latest = active?.epoch.at(-1) ?? null;
  const confidence = classifyConfidence(active?.validPairs ?? 0, active?.coveragePoints ?? 0, active?.fittedValues ?? []);
  return {
    algorithm: WEEKLY_GRANT_VERSION,
    headlineUsd: active?.headlineUsd ?? null,
    rawUsd: active?.rawUsd ?? null,
    confidence,
    label: confidence === "medium" || confidence === "high" ? "Stable Weekly API Value" : "Early Weekly API Value",
    coveragePoints: active?.coveragePoints ?? 0,
    weeklyUsedPercent: latest?.usedPercent ?? null,
    observedTokenCostUsd: active?.observedTokenCostUsd ?? 0,
    validPairs: active?.validPairs ?? 0,
    pricedEvents: events.filter((event) => event.eligible).length,
    pendingEvents: events.filter((event) => !event.eligible).length,
    resetsAtMs: latest?.resetsAtMs ?? null,
    planType: latest?.planType ?? null,
    series,
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
    cards[normalizeModel(id)] = card(input, output, number(cost?.cache_read ?? cost?.cacheRead, input));
    cards[normalizeModel(id)].source = "models_dev";
  }
  return cards;
}

export async function loadRateCards(fetchImpl: typeof globalThis.fetch | null = globalThis.fetch): Promise<Record<string, RateCard>> {
  const fallback: Record<string, RateCard> = Object.fromEntries(Object.entries(FALLBACK_CARDS).map(([id, value]) => [id, { ...value, source: "official" }]));
  if (!fetchImpl) return fallback;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetchImpl("https://models.dev/api.json", { signal: controller.signal });
    if (!response.ok) return fallback;
    return { ...fallback, ...parseModelsDev(await response.json()) };
  } catch { return fallback; }
  finally { clearTimeout(timeout); }
}

export async function estimateCodexGrant(options: EstimateOptions = {}) {
  const home = path.resolve(options.home || String(process.env.CODEX_HOME || "").split(",")[0] || path.join(os.homedir(), ".codex"));
  const cutoff = Number.isFinite(options.days) ? Date.now() - options.days * 86_400_000 : -Infinity;
  const files = [...walkJsonl(path.join(home, "sessions"), cutoff), ...walkJsonl(path.join(home, "archived_sessions"), cutoff)];
  const parsed = files.map(parseLogFile);
  const cards = await loadRateCards(options.noNetwork ? null : options.fetch);
  const events = parsed.flatMap((item) => item.events).map((event) => priceTokens(event, cards));
  const report = estimateGrantFromLogs(events, parsed.flatMap((item) => item.observations));
  const pricingSources = [...new Set(events.filter((event) => event.eligible).map((event) => event.pricingStatus))].sort();
  return {
    ...report,
    pricingSources,
    rateCardMode: options.noNetwork ? "offline" : "online-with-fallback",
    codexHome: home,
    filesScanned: files.length,
    modelUsage: summarizeModelUsage(events),
    modelUsageSeries: buildModelUsageSeries(events),
  };
}
