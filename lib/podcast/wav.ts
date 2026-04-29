// Gemini TTS returns raw PCM (e.g. `audio/L16;rate=24000`). Browsers won't
// play that without a RIFF/WAV header in front of it, so we stitch one on.
// Buffer-free / globalThis-safe so this works in Convex actions and in Node.

type WavOptions = {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
};

function parseMimeType(mimeType: string): WavOptions {
  const [fileType, ...params] = mimeType.split(";").map((s) => s.trim());
  const [, format] = fileType.split("/");

  const opts: WavOptions = {
    numChannels: 1,
    sampleRate: 24000,
    bitsPerSample: 16,
  };

  if (format && format.startsWith("L")) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) opts.bitsPerSample = bits;
  }
  for (const p of params) {
    const [key, value] = p.split("=").map((s) => s.trim());
    if (key === "rate") {
      const r = parseInt(value, 10);
      if (!isNaN(r)) opts.sampleRate = r;
    }
  }
  return opts;
}

function createWavHeader(dataLength: number, opts: WavOptions): Uint8Array {
  const { numChannels, sampleRate, bitsPerSample } = opts;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) header[offset + i] = s.charCodeAt(i);
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);
  return header;
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function pcmToWav(base64Pcm: string, mimeType: string): Uint8Array {
  const pcm = base64ToBytes(base64Pcm);
  const header = createWavHeader(pcm.length, parseMimeType(mimeType));
  const out = new Uint8Array(header.length + pcm.length);
  out.set(header, 0);
  out.set(pcm, header.length);
  return out;
}

// Sample rate * channels * (bits/8) bytes per second.
export function pcmDurationSeconds(
  byteLength: number,
  mimeType: string,
): number {
  const { numChannels, sampleRate, bitsPerSample } = parseMimeType(mimeType);
  const bytesPerSecond = (sampleRate * numChannels * bitsPerSample) / 8;
  if (bytesPerSecond <= 0) return 0;
  return byteLength / bytesPerSecond;
}
