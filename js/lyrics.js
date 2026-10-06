// Lyrics the listener pastes in themselves (Spotify's API doesn't provide
// lyrics). Saved per track in localStorage, shown as an overlay, and
// highlighted line by line when they're in time-synced .lrc format.

import { parseLyrics, activeLineIndex } from "./lyrics-parser.js";

const STORE_KEY = "wave_lyrics_store";

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (e) { return {}; }
}

function writeStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function line(text, current) {
  const div = document.createElement("div");
  div.className = current ? "lline current" : "lline";
  div.textContent = text;
  return div;
}

// getKey() -> a string identifying the current track, or null
// getTime() -> playback position in seconds
// getLabel() -> the track title shown in the editor
export function createLyrics({ els, getKey, getTime, getLabel, toast }) {
  let enabled = false;
  let data = null;
  let lastKey;
  let lastIdx = null;

  function render() {
    lastIdx = null;
    const key = getKey();
    const raw = key ? loadStore()[key] : null;
    els.lines.replaceChildren();
    els.lines.className = "lyrics-lines";

    if (!raw) {
      data = null;
      els.empty.hidden = false;
      els.emptyText.textContent = key ? "No lyrics for this track yet." : "Play a track to add lyrics.";
      els.editBtn.hidden = true;
      return;
    }

    data = parseLyrics(raw);
    els.empty.hidden = true;
    els.editBtn.hidden = false;
    els.lines.classList.add(data.type);
    if (data.type === "plain") data.lines.forEach((t) => els.lines.appendChild(line(t, false)));
  }

  function updateVisibility() {
    els.overlay.hidden = !(enabled && getKey());
  }

  function tick() {
    if (!enabled) return;
    const key = getKey();
    if (key !== lastKey) { lastKey = key; render(); updateVisibility(); }
    if (!data || data.type !== "synced") return;

    const L = data.lines;
    const idx = activeLineIndex(L, getTime());
    if (idx === lastIdx) return;
    lastIdx = idx;
    const rows = [];
    if (idx > 0) rows.push(line(L[idx - 1].text, false));
    if (idx >= 0) rows.push(line(L[idx].text, true));
    if (idx + 1 < L.length) rows.push(line(L[idx + 1].text, false));
    els.lines.replaceChildren(...rows);
  }
  setInterval(tick, 250);

  function setEnabled(on) {
    enabled = on;
    els.toggles.forEach((b) => b.setAttribute("aria-pressed", String(on)));
    lastKey = undefined;
    if (on) render();
    updateVisibility();
  }

  function openEditor() {
    const key = getKey();
    if (!key) { toast("Play a track first."); return; }
    els.modalTrack.textContent = getLabel();
    els.textarea.value = loadStore()[key] || "";
    els.modal.showModal();
    els.textarea.focus();
  }

  function save() {
    const key = getKey();
    if (!key) return;
    const store = loadStore();
    if (els.textarea.value.trim()) store[key] = els.textarea.value; else delete store[key];
    try { writeStore(store); } catch (e) { toast("Couldn't save lyrics. Browser storage may be full."); }
    els.modal.close();
    lastKey = undefined;
    render();
    updateVisibility();
  }

  els.toggles.forEach((b) => b.addEventListener("click", () => setEnabled(!enabled)));
  els.addBtn.addEventListener("click", openEditor);
  els.editBtn.addEventListener("click", openEditor);
  els.cancelBtn.addEventListener("click", () => els.modal.close());
  els.clearBtn.addEventListener("click", () => { els.textarea.value = ""; els.textarea.focus(); });
  els.saveBtn.addEventListener("click", save);
  els.modal.addEventListener("click", (e) => { if (e.target === els.modal) els.modal.close(); });

  return { refresh: () => { lastKey = undefined; updateVisibility(); } };
}
