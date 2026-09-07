import { compactFormat, moneyFormat } from "./format.js";

export const RESET_DOT = "·";
export const RESET_MARK = "···";

function usd(value: number) {
  return moneyFormat.format(value);
}

function setBraille(pixels: number[][], x: number, y: number) {
  const cellX = Math.floor(x / 2);
  const cellY = Math.floor(y / 4);
  const dotX = x % 2;
  const dotY = y % 4;
  const bits = [[1, 2, 4, 64], [8, 16, 32, 128]];
  if (!pixels[cellY] || pixels[cellY][cellX] == null) return;
  pixels[cellY][cellX] |= bits[dotX][dotY];
}

function drawLine(pixels: number[][], x0: number, y0: number, x1: number, y1: number) {
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

export function lineChart(points, field: string, width: number, height: number, prefix: string) {
  const clean = points.filter((point) => point[field] != null && Number.isFinite(Number(point[field])));
  if (!clean.length) return ["No measurements in this range"];
  const cellWidth = Math.max(12, width);
  const pixelWidth = cellWidth * 2;
  const pixelHeight = height * 4;
  const values = clean.map((point) => Number(point[field]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const times = clean.map((point) => Number(point.timestampMs));
  const timed = times.every(Number.isFinite);
  const t0 = timed ? Math.min(...times) : 0;
  const tSpan = timed ? Math.max(1, Math.max(...times) - t0) : Math.max(1, clean.length - 1);
  const pixels = Array.from({ length: height }, () => Array(cellWidth).fill(0));
  const coordinates = clean.map((point, index) => ({
    x: timed
      ? Math.round((Number(point.timestampMs) - t0) / tSpan * (pixelWidth - 1))
      : (clean.length === 1 ? pixelWidth - 1 : Math.round(index * (pixelWidth - 1) / (clean.length - 1))),
    y: pixelHeight - 1 - Math.round((Number(point[field]) - min) / span * (pixelHeight - 1)),
    epoch: point.epoch,
    resetsAtMs: Number(point.resetsAtMs),
  }));
  const resetRanges: Array<[number, number]> = [];
  coordinates.forEach((point, index) => {
    const previous = coordinates[index - 1];
    if (!previous || point.epoch !== previous.epoch) {
      setBraille(pixels, point.x, point.y);
      if (previous && point.epoch !== previous.epoch) {
        const left = Math.min(previous.x, point.x);
        const right = Math.max(previous.x, point.x);
        const leftCell = Math.min(cellWidth - 1, Math.max(0, Math.floor((left + 1) / 2)));
        const rightCell = Math.min(cellWidth - 1, Math.max(0, Math.floor(Math.max(left + 1, right - 1) / 2)));
        if (leftCell <= rightCell) resetRanges.push([leftCell, rightCell]);
      }
    } else drawLine(pixels, previous.x, previous.y, point.x, point.y);
  });
  const format = (value: number) => prefix === "$" ? usd(value) : prefix === "%" ? `${value.toFixed(1)}%` : compactFormat.format(value);
  const middle = (min + max) / 2;
  const labelWidth = Math.max(format(min).length, format(max).length, format(middle).length);
  return pixels.map((row, index) => {
    const axis = index === 0 ? format(max) : index === Math.floor(height / 2) ? format(middle) : index === height - 1 ? format(min) : "";
    const graph = row.map((bits, cellX) => {
      if (resetRanges.some(([left, right]) => cellX >= left && cellX <= right)) return RESET_DOT;
      return bits ? String.fromCodePoint(0x2800 + bits) : " ";
    }).join("");
    return `${axis.padStart(labelWidth)} ${index === height - 1 ? "└" : "│"}${graph}`;
  });
}
