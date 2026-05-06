/**
 * Audio helpers for the realtime "deep dive" voice call (Gemini Live).
 *
 * Gemini Live wire format (per docs):
 *   Input:  raw 16-bit PCM, 16 kHz, little-endian, mono (sent base64-encoded)
 *   Output: raw 16-bit PCM, 24 kHz, little-endian, mono (received base64)
 *
 * Capture downsamples from the AudioContext rate (typically 48 kHz) to 16 kHz
 * inside an AudioWorklet (see public/audio-worklet-processor.js) so the main
 * thread stays free; playback schedules buffer-source nodes back-to-back so
 * gaplessly-streamed model audio sounds continuous instead of stuttery.
 *
 * iOS Safari note: AudioContexts must be created and resumed inside a
 * user-gesture event handler, and getUserMedia must be invoked synchronously
 * from that same gesture chain. After any await the gesture is gone. The
 * `prewarmAudio()` helper exists so callers can do all of that up front
 * (synchronously) and then hand the warm handle to startPCMCapture / PCMPlayer
 * once the rest of the call setup (mint, websocket open, etc.) is ready.
 */

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const FLUSH_INTERVAL_SECONDS = 0.1;

// ── Encoding helpers ──────────────────────────────────────────────────────

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ── PCM conversion ────────────────────────────────────────────────────────

function int16ToFloat32(int16Buffer: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(int16Buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    // Asymmetric scaling: positive samples have one less code than negatives
    // (max int16 is +32767 vs -32768), so use the appropriate divisor.
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

// ── Pre-warm (iOS Safari user-gesture acquisition) ────────────────────────

export interface PrewarmedAudio {
  /** Promise that resolves to the mic stream once permission is granted. */
  streamPromise: Promise<MediaStream>;
  /** AudioContext for capture (48 kHz). Already .resume()'d. */
  captureContext: AudioContext;
  /** AudioContext for playback (24 kHz). Already .resume()'d. */
  playbackContext: AudioContext;
  /** Resolves once both contexts are running. */
  ready: Promise<void>;
  /**
   * Tear everything down without it ever being used. Call this if the call
   * setup fails between prewarm and the capture/player handoff (mint error,
   * websocket reject, mic denial). Idempotent.
   */
  abort: () => void;
}

/**
 * MUST be called synchronously from within a user-gesture event handler,
 * before any `await`. iOS Safari rejects getUserMedia and refuses to resume
 * AudioContexts otherwise.
 */
export function prewarmAudio(): PrewarmedAudio {
  const captureContext = new AudioContext({ sampleRate: 48_000 });
  const playbackContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });

  const streamPromise = navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48_000,
      channelCount: 1,
    },
  });

  const ready = Promise.all([
    captureContext.resume(),
    playbackContext.resume(),
  ]).then(() => undefined);

  let aborted = false;
  return {
    streamPromise,
    captureContext,
    playbackContext,
    ready,
    abort: () => {
      if (aborted) return;
      aborted = true;
      streamPromise
        .then((s) => s.getTracks().forEach((t) => t.stop()))
        .catch(() => {});
      captureContext.close().catch(() => {});
      playbackContext.close().catch(() => {});
    },
  };
}

// ── Mic capture via AudioWorklet ──────────────────────────────────────────

export interface PCMCaptureHandle {
  stop: () => void;
  audioContext: AudioContext;
  stream: MediaStream;
  /**
   * The MediaStreamAudioSourceNode wired up inside this capture. Exposed so
   * downstream consumers (e.g. a waveform visualiser) can attach an
   * AnalyserNode to the *same* mic source rather than spinning up a duplicate
   * MediaStreamSource — using two source nodes for the same MediaStream
   * works but doubles the realtime audio graph cost for no benefit.
   */
  sourceNode: MediaStreamAudioSourceNode;
}

export interface PCMCaptureOptions {
  /**
   * Pre-acquired mic stream (from `prewarmAudio()`). When provided, we skip
   * the internal getUserMedia call — required on iOS Safari where the
   * permission prompt only fires from the original user gesture.
   */
  stream?: MediaStream;
  /**
   * Pre-acquired AudioContext. When provided, we skip creating one. Required
   * on iOS Safari for the same reason as `stream`.
   */
  audioContext?: AudioContext;
}

/**
 * Open the mic, route it through a downsampling AudioWorklet, and call
 * `onChunk` with a base64-encoded 16 kHz 16-bit PCM payload roughly every
 * 100 ms. Caller stops by invoking the returned `stop` handle.
 *
 * On iOS Safari, callers MUST pass `stream` and `audioContext` from
 * `prewarmAudio()` — the internal getUserMedia / new AudioContext path will
 * fail outside the user-gesture window.
 */
export async function startPCMCapture(
  onChunk: (base64PCM: string) => void,
  opts: PCMCaptureOptions = {},
): Promise<PCMCaptureHandle> {
  const stream = opts.stream
    ?? (await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48_000,
        channelCount: 1,
      },
    }));

  const audioContext = opts.audioContext
    ?? new AudioContext({ sampleRate: 48_000 });

  // Defensive: if the context was passed in already-running, this is a no-op.
  // If it was created here (or somehow ended up suspended), nudge it to
  // running. iOS Safari requires a gesture for resume(), but the prewarm
  // path has already covered that.
  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => {});
  }

  const source = audioContext.createMediaStreamSource(stream);

  await audioContext.audioWorklet.addModule("/audio-worklet-processor.js");

  const workletNode = new AudioWorkletNode(
    audioContext,
    "pcm-capture-processor",
    {
      processorOptions: {
        targetSampleRate: INPUT_SAMPLE_RATE,
      },
    },
  );

  workletNode.port.onmessage = (event: MessageEvent) => {
    if (event.data?.type === "pcm_data") {
      const base64 = arrayBufferToBase64(event.data.data);
      onChunk(base64);
    }
  };

  source.connect(workletNode);
  // The worklet doesn't render audible output, but connecting it to the
  // destination keeps the AudioContext processing — without this connection
  // some browsers stop scheduling worklet callbacks.
  workletNode.connect(audioContext.destination);

  const stop = () => {
    try {
      workletNode.port.onmessage = null;
      workletNode.disconnect();
      source.disconnect();
    } catch {
      // double-stop is fine
    }
    stream.getTracks().forEach((t) => t.stop());
    audioContext.close().catch(() => {});
  };

  return { stop, audioContext, stream, sourceNode: source };
}

// ── Playback (24 kHz PCM stream from Gemini) ──────────────────────────────

/**
 * Schedules incoming PCM chunks back-to-back via AudioContext's precise
 * timeline so the user hears a continuous voice rather than stuttering
 * concatenations. `onPlaybackStart` / `onPlaybackEnd` are useful for the
 * "AI is speaking" visual state without needing to inspect the WS stream.
 *
 * On iOS Safari, pass `audioContext` from `prewarmAudio()` — a context
 * created here would start suspended and never play.
 */
export class PCMPlayer {
  private audioContext: AudioContext;
  private nextStartTime = 0;
  private isPlaying = false;
  private onPlaybackStart?: () => void;
  private onPlaybackEnd?: () => void;
  private activeSources = new Set<AudioBufferSourceNode>();

  constructor(opts?: {
    audioContext?: AudioContext;
    onPlaybackStart?: () => void;
    onPlaybackEnd?: () => void;
  }) {
    this.audioContext = opts?.audioContext
      ?? new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }
    this.onPlaybackStart = opts?.onPlaybackStart;
    this.onPlaybackEnd = opts?.onPlaybackEnd;
  }

  play(base64PCM: string): void {
    const buffer = base64ToArrayBuffer(base64PCM);
    const float32 = int16ToFloat32(buffer);
    if (float32.length === 0) return;

    const audioBuffer = this.audioContext.createBuffer(
      1,
      float32.length,
      OUTPUT_SAMPLE_RATE,
    );
    audioBuffer.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    const now = this.audioContext.currentTime;
    const startAt = Math.max(now, this.nextStartTime);
    this.nextStartTime = startAt + audioBuffer.duration;

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.onPlaybackStart?.();
    }

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0) {
        this.isPlaying = false;
        this.onPlaybackEnd?.();
      }
    };

    source.start(startAt);
  }

  /**
   * Cancel any in-flight playback (barge-in). Stops scheduled sources in
   * place rather than recreating the AudioContext — on iOS Safari a fresh
   * context starts suspended, which would silence every model response after
   * the first interrupt.
   */
  interrupt(): void {
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // already stopped / not yet started
      }
    }
    this.activeSources.clear();
    this.nextStartTime = 0;
    if (this.isPlaying) {
      this.isPlaying = false;
      this.onPlaybackEnd?.();
    }
  }

  destroy(): void {
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // already stopped
      }
    }
    this.activeSources.clear();
    this.audioContext.close().catch(() => {});
    this.isPlaying = false;
  }
}

export const GEMINI_AUDIO = {
  INPUT_SAMPLE_RATE,
  OUTPUT_SAMPLE_RATE,
  FLUSH_INTERVAL_SECONDS,
} as const;
