// Generates the demo track in the browser with an OfflineAudioContext, so
// there's no audio file to host and no licensing to worry about. The result
// is a WAV Blob that plays through the same path as an uploaded file.
//
// 16 bars at 112 BPM (~34 s): a 4-bar intro of pads and hats, then kick,
// clap and bass come in, and an arpeggio joins for the last 4 bars.

const BPM = 112;
const BARS = 16;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const SAMPLE_RATE = 44100;
const TAIL = 1.5;

// Am – F – C – G, one chord per bar.
const ROOTS = [110.0, 87.31, 130.81, 98.0];
const CHORDS = [
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66]
];

function noiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function envelope(ctx, out, time, peak, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(peak, time + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  g.connect(out);
  return g;
}

function kick(ctx, out, time) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(130, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
  osc.connect(envelope(ctx, out, time, 1.0, 0.002, 0.42));
  osc.start(time);
  osc.stop(time + 0.5);
}

function noiseHit(ctx, out, noise, time, { type, freq, q = 1, peak, decay }) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  src.connect(filter);
  filter.connect(envelope(ctx, out, time, peak, 0.001, decay));
  src.start(time, Math.random() * 0.5);
  src.stop(time + decay + 0.05);
}

function tone(ctx, out, { type, freq, time, length, peak, cutoff, detune = 0 }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  osc.connect(filter);
  filter.connect(envelope(ctx, out, time, peak, 0.01, length));
  osc.start(time);
  osc.stop(time + length + 0.05);
}

function pad(ctx, out, chord, time) {
  for (const freq of chord) {
    for (const detune of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.035, time + 0.6);
      g.gain.linearRampToValueAtTime(0.0001, time + BAR + 0.3);
      osc.connect(g);
      g.connect(out);
      osc.start(time);
      osc.stop(time + BAR + 0.4);
    }
  }
}

export async function renderDemoTrack() {
  const length = Math.ceil((BARS * BAR + TAIL) * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);

  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp);
  comp.connect(ctx.destination);

  const noise = noiseBuffer(ctx);

  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * BAR;
    const chordIdx = bar % 4;
    const full = bar >= 4;

    pad(ctx, master, CHORDS[chordIdx], t0);

    for (let beat = 0; beat < 4; beat++) {
      const tb = t0 + beat * BEAT;
      if (full) kick(ctx, master, tb);
      if (full && (beat === 1 || beat === 3)) {
        noiseHit(ctx, master, noise, tb, { type: "bandpass", freq: 1600, q: 0.8, peak: 0.45, decay: 0.2 });
      }
      noiseHit(ctx, master, noise, tb + BEAT / 2, { type: "highpass", freq: 7500, peak: 0.16, decay: 0.05 });
    }

    if (full) {
      for (let step = 0; step < 8; step++) {
        const freq = ROOTS[chordIdx] * (step % 4 === 3 ? 2 : 1);
        tone(ctx, master, { type: "sawtooth", freq, time: t0 + step * (BEAT / 2), length: BEAT / 2 - 0.02, peak: 0.22, cutoff: 520 });
      }
    }

    if (bar >= 12) {
      const notes = CHORDS[chordIdx];
      for (let step = 0; step < 16; step++) {
        const freq = notes[step % 3] * 2;
        tone(ctx, master, { type: "square", freq, time: t0 + step * (BEAT / 4), length: BEAT / 4, peak: 0.05, cutoff: 2400 });
      }
    }
  }

  const buffer = await ctx.startRendering();
  return encodeWav(buffer);
}

function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const view = new DataView(new ArrayBuffer(44 + dataSize));

  const writeString = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}
