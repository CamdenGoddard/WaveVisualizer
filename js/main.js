// Wires the page together: the start screen, the three ways to play
// (file / demo, Spotify, microphone or tab audio), the player bars, and
// the visualizer.

import * as audio from "./audio.js";
import * as spotify from "./spotify.js";
import { renderDemoTrack } from "./demo.js";
import { createLyrics } from "./lyrics.js";
import { startVisualizer } from "./visualizer.js";

const $ = (id) => document.getElementById(id);

const el = {
  start: $("start"),
  demoBtn: $("demoBtn"),
  browseBtn: $("browseBtn"),
  fileInput: $("fileInput"),
  spotifyBtn: $("spotifyBtn"),
  micBtn: $("micBtn"),
  search: $("spotifySearch"),
  searchInput: $("spotifySearchInput"),
  results: $("spotifyResults"),
  dropHint: $("dropHint"),
  toast: $("toast"),

  player: $("player"),
  playBtn: $("playBtn"),
  trackName: $("trackName"),
  curTime: $("curTime"),
  durTime: $("durTime"),
  seek: $("seek"),
  volume: $("volume"),
  changeBtn: $("changeBtn"),

  spotifyBar: $("spotifyBar"),
  spArt: $("spArt"),
  spName: $("spName"),
  spArtist: $("spArtist"),
  spPlay: $("spPlay"),
  spPrev: $("spPrev"),
  spNext: $("spNext"),
  spSync: $("spSync"),
  spSearch: $("spSearchAgain"),
  spDisconnect: $("spDisconnect"),

  micBar: $("micBar"),
  micStop: $("micStop")
};

// One of: "idle" (start screen), "file", "spotify", "mic".
let mode = "idle";
let trackLabel = "";

const PLAY_ICON = '<path d="M7 5.5v13L18 12z"/>';
const PAUSE_ICON = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';

// ---------- small helpers ----------
let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3600);
}

function fmt(s) {
  if (!isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function setMode(next) {
  mode = next;
  el.start.hidden = next !== "idle";
  el.player.hidden = next !== "file";
  el.spotifyBar.hidden = next !== "spotify";
  el.micBar.hidden = next !== "mic";
  lyrics.refresh();
}

function setIcon(button, playing) {
  button.querySelector("svg").innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  button.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function backToStart() {
  audio.audioEl.pause();
  audio.stopMic();
  audio.stopTabCapture();
  resetSyncButton();
  el.fileInput.value = "";
  setMode("idle");
}

// ---------- files and the demo ----------
async function playBlob(blob, label) {
  spotify.pause();
  audio.stopMic();
  audio.stopTabCapture();
  trackLabel = label;
  el.trackName.textContent = label;
  setMode("file");
  try {
    await audio.playBlob(blob);
  } catch (e) {
    console.error(e);
    toast("Press play to start. Your browser blocked autoplay.");
  }
  setIcon(el.playBtn, !audio.audioEl.paused);
  wakeControls();
}

function playFile(file) {
  if (!file) return;
  if (!/^(audio|video)\//.test(file.type)) {
    toast("That isn't an audio or video file. Try MP3, WAV, M4A, MP4 or MOV.");
    return;
  }
  playBlob(file, file.name.replace(/\.[^/.]+$/, ""));
}

// Render the demo in the background shortly after load so the button feels instant.
let demoPromise = null;
function demoTrack() {
  demoPromise = demoPromise || renderDemoTrack().catch((e) => { demoPromise = null; throw e; });
  return demoPromise;
}
(window.requestIdleCallback || ((fn) => setTimeout(fn, 1500)))(() => demoTrack().catch(() => {}));

el.demoBtn.addEventListener("click", async () => {
  const label = el.demoBtn.textContent;
  el.demoBtn.disabled = true;
  el.demoBtn.textContent = "Generating demo track…";
  try {
    await playBlob(await demoTrack(), "Demo loop (generated in your browser)");
  } catch (e) {
    console.error(e);
    toast("Couldn't generate the demo track in this browser.");
  } finally {
    el.demoBtn.disabled = false;
    el.demoBtn.textContent = label;
  }
});

el.browseBtn.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("change", (e) => playFile(e.target.files[0]));
el.changeBtn.addEventListener("click", backToStart);

// Drag and drop anywhere on the page.
let dragDepth = 0;
window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; el.dropHint.hidden = false; });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; el.dropHint.hidden = true; } });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.dropHint.hidden = true;
  playFile(e.dataTransfer.files && e.dataTransfer.files[0]);
});

// ---------- file player controls ----------
el.playBtn.addEventListener("click", async () => {
  if (audio.audioEl.paused) {
    try { await audio.resumeAndPlay(); } catch (e) { toast("Playback failed. Try a different file."); }
  } else {
    audio.audioEl.pause();
  }
});
audio.audioEl.addEventListener("play", () => setIcon(el.playBtn, true));
audio.audioEl.addEventListener("pause", () => setIcon(el.playBtn, false));
audio.audioEl.addEventListener("loadedmetadata", () => { el.durTime.textContent = fmt(audio.audioEl.duration); });
audio.audioEl.addEventListener("error", () => {
  const reasons = { 3: "the file may be damaged", 4: "this browser can't play that format" };
  const err = audio.audioEl.error;
  if (mode === "file") toast(`Couldn't play that file: ${(err && reasons[err.code]) || "unknown error"}.`);
});

let seeking = false;
audio.audioEl.addEventListener("timeupdate", () => {
  if (seeking) return;
  el.curTime.textContent = fmt(audio.audioEl.currentTime);
  if (audio.audioEl.duration) el.seek.value = (audio.audioEl.currentTime / audio.audioEl.duration) * 1000;
});
el.seek.addEventListener("input", () => {
  seeking = true;
  el.curTime.textContent = fmt((el.seek.value / 1000) * (audio.audioEl.duration || 0));
});
el.seek.addEventListener("change", () => {
  if (audio.audioEl.duration) audio.audioEl.currentTime = (el.seek.value / 1000) * audio.audioEl.duration;
  seeking = false;
});

audio.audioEl.volume = Number(el.volume.value);
el.volume.addEventListener("input", () => {
  audio.audioEl.volume = Number(el.volume.value);
  spotify.setVolume(Number(el.volume.value));
});

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || mode !== "file") return;
  if (e.target.closest("input, textarea, button, dialog")) return;
  e.preventDefault();
  el.playBtn.click();
});

// Fade the bars out while music plays and nothing is moving.
let idleTimer;
function wakeControls() {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const playing = (mode === "file" && !audio.audioEl.paused) || mode === "spotify" || mode === "mic";
    if (playing && !document.querySelector("dialog[open]")) document.body.classList.add("idle");
  }, 3500);
}
["pointermove", "pointerdown", "keydown"].forEach((evt) => window.addEventListener(evt, wakeControls));

// ---------- microphone ----------
el.micBtn.hidden = !audio.supportsMic;
el.micBtn.addEventListener("click", async () => {
  try {
    await audio.startMic(backToStart);
    trackLabel = "";
    setMode("mic");
    wakeControls();
  } catch (e) {
    console.error(e);
    toast("Microphone access was blocked. Allow it in your browser's site settings.");
  }
});
el.micStop.addEventListener("click", backToStart);

// ---------- Spotify ----------
const spotifyHandlers = {
  volume: Number(el.volume.value),
  onError: toast,
  onReady: () => {
    el.spotifyBtn.textContent = "Search Spotify";
    el.spotifyBtn.setAttribute("aria-expanded", "true");
    el.search.hidden = false;
  },
  onState: (s) => {
    el.spName.textContent = s.name;
    el.spArtist.textContent = s.artists;
    el.spArt.src = s.art;
    el.spArt.hidden = !s.art;
    trackLabel = s.name;
    setIcon(el.spPlay, !s.paused);
    if (mode !== "spotify" && !s.paused) {
      audio.audioEl.pause();
      audio.stopMic();
      setMode("spotify");
      wakeControls();
    }
  }
};

el.spotifyBtn.addEventListener("click", () => {
  if (spotify.isReady()) {
    el.search.hidden = !el.search.hidden;
    if (!el.search.hidden) el.searchInput.focus();
    return;
  }
  el.spotifyBtn.textContent = "Opening Spotify…";
  spotify.signIn();
});

let searchTimer;
el.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 350);
});

async function runSearch() {
  const q = el.searchInput.value.trim();
  el.results.replaceChildren();
  if (!q) return;
  try {
    const tracks = await spotify.search(q);
    if (!tracks.length) {
      const empty = document.createElement("li");
      empty.className = "result-empty";
      empty.textContent = `Nothing found for "${q}".`;
      el.results.append(empty);
      return;
    }
    for (const track of tracks) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "result";
      const img = document.createElement("img");
      img.src = track.thumb;
      img.alt = "";
      const text = document.createElement("span");
      const title = document.createElement("span");
      title.className = "result-title";
      title.textContent = track.name;
      const artist = document.createElement("span");
      artist.className = "result-artist";
      artist.textContent = track.artists;
      text.append(title, artist);
      btn.append(img, text);
      btn.addEventListener("click", () => spotify.play(track.uri).catch((e) => toast(e.message)));
      li.append(btn);
      el.results.append(li);
    }
  } catch (e) {
    console.error(e);
    toast("Spotify search failed. Try again in a moment.");
  }
}

el.spPlay.addEventListener("click", spotify.togglePlay);
el.spPrev.addEventListener("click", spotify.previous);
el.spNext.addEventListener("click", spotify.next);
el.spSearch.addEventListener("click", () => {
  audio.stopTabCapture();
  resetSyncButton();
  setMode("idle");
  el.search.hidden = false;
  el.searchInput.select();
});
el.spDisconnect.addEventListener("click", () => {
  spotify.disconnect();
  el.spotifyBtn.textContent = "Connect Spotify";
  el.spotifyBtn.removeAttribute("aria-expanded");
  el.search.hidden = true;
  backToStart();
});

// The Web Playback SDK doesn't expose raw audio, so the visualizer can't
// "hear" Spotify directly. Sharing the tab's audio (desktop) or listening
// through the mic (phones) gives the analyser something to work with.
function resetSyncButton() {
  el.spSync.textContent = audio.supportsTabCapture ? "Sync visuals to audio" : "Sync visuals using the mic";
  el.spSync.disabled = false;
}
resetSyncButton();
el.spSync.hidden = !audio.supportsTabCapture && !audio.supportsMic;
el.spSync.addEventListener("click", async () => {
  el.spSync.disabled = true;
  try {
    if (audio.supportsTabCapture) await audio.startTabCapture(resetSyncButton);
    else await audio.startMic(resetSyncButton);
    el.spSync.textContent = "Visuals synced";
  } catch (e) {
    console.error(e);
    toast(e.message && e.message.startsWith("No audio") ? e.message : "Audio sharing was blocked or cancelled.");
    resetSyncButton();
  }
});

// ---------- lyrics ----------
const lyrics = createLyrics({
  els: {
    overlay: $("lyrics"),
    lines: $("lyricsLines"),
    empty: $("lyricsEmpty"),
    emptyText: $("lyricsEmptyText"),
    addBtn: $("lyricsAdd"),
    editBtn: $("lyricsEdit"),
    toggles: document.querySelectorAll(".lyrics-toggle"),
    modal: $("lyricsModal"),
    modalTrack: $("lyricsModalTrack"),
    textarea: $("lyricsText"),
    clearBtn: $("lyricsClear"),
    cancelBtn: $("lyricsCancel"),
    saveBtn: $("lyricsSave")
  },
  getKey: () => {
    if (mode === "spotify" && spotify.currentTrackId()) return `spotify:${spotify.currentTrackId()}`;
    if (mode === "file" && trackLabel) return `file:${trackLabel}`;
    return null;
  },
  getTime: () => (mode === "spotify" ? spotify.positionSeconds() : audio.audioEl.currentTime),
  getLabel: () => trackLabel,
  toast
});

// ---------- start ----------
startVisualizer($("stage"), () => {
  const active = (mode === "file" && !audio.audioEl.paused) || mode === "spotify" || mode === "mic" || audio.isCapturing();
  return active ? audio.frequencyData() : null;
});

setMode("idle");
spotify.restoreSession(spotifyHandlers).catch((e) => {
  console.error(e);
  el.spotifyBtn.textContent = "Connect Spotify";
  toast(e.message.includes("cancelled") ? e.message : "Couldn't connect to Spotify. Your account may not have access yet.");
});
