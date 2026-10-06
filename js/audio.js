// Audio input + analysis. Every source (a file, tab audio, the microphone)
// feeds one shared AnalyserNode, which the visualizer reads each frame.
//
//   <audio> element ──┬──────────────► speakers
//                     └──► analyser ──► (silent sink)
//   tab audio / mic ──────► analyser       (analysis only, never to speakers,
//                                           so the mic can't feed back)

export const audioEl = new Audio();
audioEl.preload = "auto";

export const supportsTabCapture = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
export const supportsMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

let ctx = null;
let analyser = null;
let freqData = null;
let elementNode = null;
let objectUrl = null;

const tab = { stream: null, node: null };
const mic = { stream: null, node: null };

function ensureContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (!analyser) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;
    freqData = new Uint8Array(analyser.frequencyBinCount);

    // Keep the analyser in the rendered graph without making it audible.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    analyser.connect(sink);
    sink.connect(ctx.destination);
  }
  return ctx;
}

async function resume() {
  ensureContext();
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch (e) { console.error("AudioContext resume failed", e); }
  }
}

function connectElement() {
  ensureContext();
  if (elementNode) return;
  elementNode = ctx.createMediaElementSource(audioEl);
  elementNode.connect(ctx.destination);
  elementNode.connect(analyser);
}

// Plays a File or Blob through the <audio> element. Object URLs stream from
// disk instead of reading the whole file into memory.
export async function playBlob(blob) {
  connectElement();
  await resume();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  audioEl.src = objectUrl;
  await audioEl.play();
}

export async function resumeAndPlay() {
  await resume();
  await audioEl.play();
}

export function frequencyData() {
  if (!analyser) return null;
  analyser.getByteFrequencyData(freqData);
  return freqData;
}

export function isCapturing() {
  return !!(tab.node || mic.node);
}

async function attachStream(target, stream) {
  await resume();
  target.stream = stream;
  target.node = ctx.createMediaStreamSource(stream);
  target.node.connect(analyser);
}

function detach(target) {
  if (target.node) { try { target.node.disconnect(); } catch (e) { /* already gone */ } }
  if (target.stream) target.stream.getTracks().forEach((t) => t.stop());
  target.node = null;
  target.stream = null;
}

// Desktop: share a browser tab's audio (e.g. Spotify playing in another tab).
export async function startTabCapture(onEnded) {
  if (!supportsTabCapture || tab.node) return;
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach((t) => t.stop());
  const [track] = stream.getAudioTracks();
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No audio was shared. Try again and turn on "Share tab audio".');
  }
  await attachStream(tab, new MediaStream([track]));
  track.addEventListener("ended", () => { stopTabCapture(); onEnded && onEnded(); });
}

export function stopTabCapture() { detach(tab); }

// Phones and anything else: listen to music playing nearby through the mic.
export async function startMic(onEnded) {
  if (!supportsMic || mic.node) return;
  // Voice-call processing is built to remove background sound, which is
  // exactly the music we want to hear, so turn it all off.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  });
  await attachStream(mic, stream);
  stream.getAudioTracks()[0].addEventListener("ended", () => { stopMic(); onEnded && onEnded(); });
}

export function stopMic() { detach(mic); }
