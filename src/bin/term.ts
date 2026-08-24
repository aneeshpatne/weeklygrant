import readline from "node:readline";
import { styleText } from "node:util";

const ANSI_RE = /\x1B\[[0-9;]*m/g;
const ELLIPSIS = "…";

export const ROUND_BOX = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" } as const;
export const DOUBLE_BOX = { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" } as const;

export type Color = "cyan" | "green" | "yellow" | "red" | "magenta" | "gray" | "white";

export type TermKey = {
  input: string;
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  escape: boolean;
  return: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  upArrow: boolean;
  downArrow: boolean;
};

export type StyleOpts = {
  color?: Color;
  bold?: boolean;
  dim?: boolean;
};

export function stripAnsi(text: string) {
  return text.replace(ANSI_RE, "");
}

export function visibleWidth(text: string) {
  return [...stripAnsi(text)].length;
}

export function style(text: string, opts: StyleOpts = {}) {
  const mods: string[] = [];
  if (opts.bold) mods.push("bold");
  if (opts.dim) mods.push("dim");
  if (opts.color && opts.color !== "white") mods.push(opts.color);
  let out = text;
  for (const mod of mods) {
    try { out = styleText(mod as any, out); } catch { /* ignore unsupported styles */ }
  }
  return out;
}

export function truncate(text: string, width: number) {
  const chars = [...text];
  if (width <= 0) return "";
  if (chars.length <= width) return text;
  if (width === 1) return ELLIPSIS;
  return `${chars.slice(0, width - 1).join("")}${ELLIPSIS}`;
}

export function padVisible(text: string, width: number, align: "left" | "right" = "left") {
  const w = visibleWidth(text);
  if (w === width) return text;
  if (w > width) return truncate(stripAnsi(text), width);
  const pad = " ".repeat(width - w);
  return align === "right" ? pad + text : text + pad;
}

export function wrapText(text: string, width: number) {
  if (width <= 0) return [text];
  if (visibleWidth(text) <= width) return [text];
  const lines: string[] = [];
  let current = "";
  const push = (chunk: string) => {
    if (!chunk) return;
    if (visibleWidth(chunk) <= width) {
      lines.push(chunk);
      return;
    }
    const chars = [...chunk];
    for (let i = 0; i < chars.length; i += width) lines.push(chars.slice(i, i + width).join(""));
  };
  for (const word of text.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (visibleWidth(next) <= width) current = next;
    else {
      if (current) lines.push(current);
      current = "";
      if (visibleWidth(word) > width) push(word);
      else current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function padX(lines: string[], n: number) {
  const pad = " ".repeat(n);
  return lines.map((line) => pad + line);
}

export function box(lines: string[], opts: {
  style?: "round" | "double";
  borderColor?: Color;
  paddingX?: number;
  paddingY?: number;
  width?: number;
} = {}) {
  const chars = opts.style === "double" ? DOUBLE_BOX : ROUND_BOX;
  const paddingX = opts.paddingX ?? 0;
  const paddingY = opts.paddingY ?? 0;
  const color = (text: string) => opts.borderColor ? style(text, { color: opts.borderColor }) : text;
  const contentWidth = Math.max(0, ...lines.map(visibleWidth));
  const inner = opts.width != null ? Math.max(0, opts.width - 2) : contentWidth + paddingX * 2;
  const textWidth = Math.max(0, inner - paddingX * 2);
  const body = [
    ...Array.from({ length: paddingY }, () => ""),
    ...lines.flatMap((line) => wrapText(line, textWidth || 1)),
    ...Array.from({ length: paddingY }, () => ""),
  ];
  const top = color(chars.tl + chars.h.repeat(inner) + chars.tr);
  const bottom = color(chars.bl + chars.h.repeat(inner) + chars.br);
  const v = color(chars.v);
  const pad = " ".repeat(paddingX);
  const middle = body.map((line) => `${v}${pad}${padVisible(line, textWidth)}${pad}${v}`);
  return [top, ...middle, bottom];
}

export function joinRow(blocks: string[][], gap = 1) {
  if (!blocks.length) return [];
  const height = Math.max(...blocks.map((block) => block.length));
  const gapStr = " ".repeat(gap);
  const padded = blocks.map((block) => {
    const width = Math.max(0, ...block.map(visibleWidth));
    const lines = [...block, ...Array.from({ length: height - block.length }, () => "")];
    return lines.map((line) => padVisible(line, width));
  });
  return Array.from({ length: height }, (_, y) => padded.map((block) => block[y]).join(gapStr));
}

function groupByWidth(blocks: string[][], columns: number, gap: number, widthOf: (block: string[]) => number) {
  const rows: string[][][] = [];
  let current: string[][] = [];
  let currentWidth = 0;
  for (const block of blocks) {
    const width = widthOf(block);
    const extra = current.length ? gap : 0;
    if (current.length && currentWidth + extra + width > columns) {
      rows.push(current);
      current = [block];
      currentWidth = width;
    } else {
      current.push(block);
      currentWidth += extra + width;
    }
  }
  if (current.length) rows.push(current);
  return rows;
}

export function wrapRow(blocks: string[][], columns: number, gap = 1) {
  if (!blocks.length) return [];
  return groupByWidth(blocks, columns, gap, (block) => Math.max(0, ...block.map(visibleWidth)))
    .flatMap((row, index) => index === 0 ? joinRow(row, gap) : ["", ...joinRow(row, gap)]);
}

export function wrapCards(contents: string[][], columns: number, gap = 1, boxOpts: Parameters<typeof box>[1] = {}) {
  if (!contents.length) return [];
  const sample = box(contents[0], boxOpts);
  const width = visibleWidth(sample[0]);
  return groupByWidth(contents, columns, gap, () => width).flatMap((row, index) => {
    const height = Math.max(...row.map((lines) => lines.length));
    const boxes = row.map((lines) => box([...lines, ...Array.from({ length: height - lines.length }, () => "")], boxOpts));
    const joined = joinRow(boxes, gap);
    return index === 0 ? joined : ["", ...joined];
  });
}

export function spaceBetween(left: string, right: string, width: number) {
  const lw = visibleWidth(left);
  const rw = visibleWidth(right);
  if (lw + rw >= width) return `${left} ${right}`.trim();
  return left + " ".repeat(width - lw - rw) + right;
}

export function normalizeKey(input: string | undefined, key: readline.Key = {}): TermKey {
  const name = key.name || "";
  const sequence = key.sequence || input || "";
  const letter = name.length === 1 ? name : "";
  const ctrlC = Boolean(key.ctrl && name === "c") || sequence === "\x03";
  return {
    input: ctrlC ? "c" : (input && input !== "\x1b" ? input : letter),
    name,
    ctrl: Boolean(key.ctrl) || ctrlC,
    meta: Boolean(key.meta),
    shift: Boolean(key.shift),
    escape: name === "escape" || sequence === "\x1b",
    return: name === "return",
    leftArrow: name === "left",
    rightArrow: name === "right",
    upArrow: name === "up",
    downArrow: name === "down",
  };
}

export function isQuitKey(key: TermKey) {
  return key.input === "q" || key.escape || (key.ctrl && key.input === "c");
}

type ConsoleFns = Pick<Console, "log" | "info" | "warn" | "error" | "debug">;

export type Terminal = {
  columns: number;
  writeFrame: (lines: string[]) => void;
  onKey: (handler: (key: TermKey) => void) => void;
  onResize: (handler: () => void) => void;
  detach: () => void;
};

export function attach(stdin: NodeJS.ReadStream = process.stdin, stdout: NodeJS.WriteStream = process.stdout): Terminal {
  const original: ConsoleFns = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
  console.debug = noop;

  const raw = Boolean(stdin.isTTY && typeof stdin.setRawMode === "function");
  if (raw) {
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
  }
  stdout.write("\x1b[?1049h\x1b[?25l");

  let keyHandler: ((key: TermKey) => void) | null = null;
  let resizeHandler: (() => void) | null = null;
  let detached = false;
  const onData = (str: string, key: readline.Key) => {
    keyHandler?.(normalizeKey(str, key));
  };
  const onResize = () => resizeHandler?.();
  const restore = () => {
    if (detached) return;
    detached = true;
    if (raw) {
      stdin.off("keypress", onData);
      try { stdin.setRawMode(false); } catch {}
      stdin.pause();
    }
    stdout.off("resize", onResize);
    try { stdout.write("\x1b[?25h\x1b[?1049l"); } catch {}
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
    process.off("exit", restore);
  };
  if (raw) stdin.on("keypress", onData);
  stdout.on("resize", onResize);
  process.on("exit", restore);

  return {
    get columns() {
      return stdout.columns || 80;
    },
    writeFrame(lines: string[]) {
      stdout.write(`\x1b[H\x1b[J${lines.join("\n")}`);
    },
    onKey(handler) { keyHandler = handler; },
    onResize(handler) { resizeHandler = handler; },
    detach: restore,
  };
}
