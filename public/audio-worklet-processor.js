/**
 * AudioWorkletProcessor for capturing raw PCM audio samples.
 *
 * Collects Float32 samples from the microphone, downsamples to
 * the target rate (default 16 kHz for Gemini Live API), converts
 * to 16-bit signed integers (little-endian), and posts the
 * resulting buffer to the main thread.
 */
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._targetSampleRate = options.processorOptions?.targetSampleRate ?? 16000;
    this._buffer = [];
    // Flush every ~100 ms worth of samples at the target rate.
    this._flushSize = Math.floor(this._targetSampleRate * 0.1);
  }

  /**
   * Downsample from the AudioContext sample rate to the target rate
   * using simple linear interpolation. This is good enough for speech
   * (16 kHz target, low-frequency content) and avoids the cost of a
   * full FIR filter inside the realtime worklet.
   */
  _downsample(inputBuffer, inputRate, outputRate) {
    if (inputRate === outputRate) return inputBuffer;
    const ratio = inputRate / outputRate;
    const outputLength = Math.floor(inputBuffer.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const low = Math.floor(srcIndex);
      const high = Math.min(low + 1, inputBuffer.length - 1);
      const frac = srcIndex - low;
      output[i] = inputBuffer[low] * (1 - frac) + inputBuffer[high] * frac;
    }
    return output;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const channelData = input[0];
    const downsampled = this._downsample(
      channelData,
      sampleRate,
      this._targetSampleRate,
    );

    for (let i = 0; i < downsampled.length; i++) {
      this._buffer.push(downsampled[i]);
    }

    if (this._buffer.length >= this._flushSize) {
      const samples = new Float32Array(this._buffer);
      this._buffer = [];

      const int16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }

      this.port.postMessage(
        { type: "pcm_data", data: int16.buffer },
        [int16.buffer],
      );
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PCMCaptureProcessor);
