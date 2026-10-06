// Spotify sign-in (OAuth Authorization Code + PKCE, no client secret) and
// in-browser playback through the Web Playback SDK. Playback needs Spotify
// Premium. Tokens are kept in localStorage so a session survives a reload.

import { randomVerifier, challengeFor } from "./pkce.js";

const CLIENT_ID = "da447bf59ac64696a02af72953f42888";
const VERIFIER_KEY = "wave_spotify_verifier";
const TOKENS_KEY = "wave_spotify_tokens";
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state";
const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

let player = null;
let deviceId = null;
let ready = false;
let trackId = null;
let posMs = 0;
let posStamp = 0;
let paused = true;

// ---------- token storage ----------
function loadTokens() {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || "null"); } catch (e) { return null; }
}

function saveTokens(t) {
  const record = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || (loadTokens() || {}).refresh_token,
    expires_at: Date.now() + (t.expires_in || 3600) * 1000
  };
  localStorage.setItem(TOKENS_KEY, JSON.stringify(record));
  return record;
}

function clearSession() {
  localStorage.removeItem(TOKENS_KEY);
  localStorage.removeItem(VERIFIER_KEY);
}

async function tokenRequest(params) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params })
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
  return res.json();
}

async function accessToken() {
  const tokens = loadTokens();
  if (!tokens) throw new Error("Not connected to Spotify");
  if (Date.now() < tokens.expires_at - 15000) return tokens.access_token;
  const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  return saveTokens(fresh).access_token;
}

async function api(path, options = {}) {
  const token = await accessToken();
  return fetch(API + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
}

// ---------- sign-in ----------
export async function signIn() {
  const verifier = randomVerifier(64);
  localStorage.setItem(VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: await challengeFor(verifier)
  });
  window.location = `${ACCOUNTS}/authorize?${params}`;
}

// Call once on page load. Finishes a sign-in redirect if there is one,
// otherwise quietly resumes a saved session. Resolves true when connected.
export async function restoreSession(handlers) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (params.get("error") || code) window.history.replaceState({}, document.title, REDIRECT_URI);
  if (params.get("error")) throw new Error("Spotify sign-in was cancelled.");

  if (code) {
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: localStorage.getItem(VERIFIER_KEY)
    });
    saveTokens(tokens);
  }
  if (!loadTokens()) return false;
  await startPlayer(handlers);
  return true;
}

// ---------- Web Playback SDK ----------
function loadSdk() {
  return new Promise((resolve, reject) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.onerror = () => reject(new Error("Couldn't load the Spotify player."));
    document.body.appendChild(s);
  });
}

async function startPlayer({ onReady, onState, onError, volume }) {
  await loadSdk();
  player = new window.Spotify.Player({
    name: "Wave Visualizer",
    getOAuthToken: (cb) => {
      accessToken().then(cb).catch(() => { onError("Your Spotify session expired. Connect again."); disconnect(); });
    },
    volume
  });

  player.addListener("ready", ({ device_id }) => { deviceId = device_id; ready = true; onReady(); });
  player.addListener("not_ready", () => { ready = false; });
  player.addListener("player_state_changed", (state) => {
    if (!state) return;
    const track = state.track_window && state.track_window.current_track;
    if (track) trackId = track.id;
    posMs = state.position;
    posStamp = Date.now();
    paused = state.paused;
    onState({
      name: track ? track.name : "",
      artists: track ? track.artists.map((a) => a.name).join(", ") : "",
      art: track && track.album.images[0] ? track.album.images[0].url : "",
      paused
    });
  });
  player.addListener("initialization_error", ({ message }) => onError(`Spotify couldn't start: ${message}`));
  player.addListener("authentication_error", () => { onError("Spotify sign-in failed. Connect again."); disconnect(); });
  player.addListener("account_error", () => onError("Playing Spotify in the browser needs a Premium account."));
  player.addListener("playback_error", ({ message }) => onError(`Spotify playback error: ${message}`));

  await player.connect();
}

export async function search(query) {
  const res = await api(`/search?type=track&limit=6&q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = await res.json();
  return ((json.tracks && json.tracks.items) || []).map((t) => ({
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(", "),
    thumb: t.album.images.length ? t.album.images[t.album.images.length - 1].url : ""
  }));
}

export async function play(uri) {
  if (!deviceId) throw new Error("The Spotify player isn't ready yet.");
  const res = await api(`/me/player/play?device_id=${deviceId}`, { method: "PUT", body: JSON.stringify({ uris: [uri] }) });
  if (!res.ok && res.status !== 204) throw new Error("Couldn't start playback. Is Spotify Premium active?");
}

export const togglePlay = () => player && player.togglePlay();
export const pause = () => player && player.pause().catch(() => {});
export const previous = () => player && player.previousTrack();
export const next = () => player && player.nextTrack();
export const setVolume = (v) => player && player.setVolume(v).catch(() => {});

export const isReady = () => ready;
export const currentTrackId = () => trackId;
export const positionSeconds = () => (paused ? posMs : posMs + (Date.now() - posStamp)) / 1000;

export function disconnect() {
  if (player) { try { player.disconnect(); } catch (e) { /* ignore */ } }
  player = null;
  deviceId = null;
  ready = false;
  trackId = null;
  clearSession();
}
