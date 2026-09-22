const REGISTRY_URL = "https://registry.npmjs.org/weeklygrant/latest";

function parseVersion(version: string): number[] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

export async function findLatestVersion(current: string, timeoutMs = 2_000): Promise<string | null> {
  try {
    const response = await fetch(REGISTRY_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = await response.json() as { version?: unknown };
    const latest = typeof data.version === "string" ? data.version : null;
    return latest && isNewerVersion(latest, current) ? latest : null;
  } catch {
    return null;
  }
}
