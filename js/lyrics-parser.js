// Parses user-pasted lyrics. Lines in .lrc format ("[mm:ss.xx] text") become
// time-synced lines; anything else is treated as plain, unsynced lyrics.

const LRC_LINE = /^\[(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]\s*(.*)$/;

export function parseLyrics(raw) {
  const rawLines = String(raw).split(/\r?\n/);
  const synced = [];
  let matchedAny = false;

  for (const line of rawLines) {
    const m = line.trim().match(LRC_LINE);
    if (!m) continue;
    matchedAny = true;
    const text = m[3].trim();
    if (text) synced.push({ time: Number(m[1]) * 60 + Number(m[2]), text });
  }

  if (matchedAny && synced.length) {
    synced.sort((a, b) => a.time - b.time);
    return { type: "synced", lines: synced };
  }
  return { type: "plain", lines: rawLines.map((l) => l.trim()).filter(Boolean) };
}

// Index of the line that should be highlighted at time `t` (seconds),
// or -1 if playback hasn't reached the first line yet.
export function activeLineIndex(lines, t) {
  let lo = 0, hi = lines.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return idx;
}
