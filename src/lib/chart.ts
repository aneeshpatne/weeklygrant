function usd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
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
  const format = (value: number) => prefix === "$" ? usd(value) : prefix === "%" ? `${value.toFixed(1)}%` : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const middle = min + span / 2;
  const labelWidth = Math.max(format(min).length, format(max).length, format(middle).length);
  return pixels.map((row, index) => {
    const axis = index === 0 ? format(max) : index === Math.floor(height / 2) ? format(middle) : index === height - 1 ? format(min) : "";
    const graph = row.map((bits) => bits ? String.fromCodePoint(0x2800 + bits) : " ").join("");
    return `${axis.padStart(labelWidth)} ${index === height - 1 ? "└" : "│"}${graph}`;
  });
}
