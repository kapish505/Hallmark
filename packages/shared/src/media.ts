/**
 * Bounded header checks for canonical inputs (section 7 G3, edge case 23): the gateway only reads
 * headers to enforce limits before settlement. Decoding happens inside the pinned worker container.
 *   ASR: WAV, PCM 16-bit, 16 kHz, mono.   OCR: PNG.
 */
export class MediaError extends Error {}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationSec: number;
}

export function probeWav(buf: Uint8Array): WavInfo {
  if (buf.length < 44) throw new MediaError("file too small");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new MediaError("not a WAV file");
  let off = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; byteRate: number; bits: number } | null = null;
  for (let guard = 0; off + 8 <= buf.length && guard < 64; guard++) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    if (id === "fmt ") {
      fmt = {
        audioFormat: dv.getUint16(off + 8, true),
        channels: dv.getUint16(off + 10, true),
        sampleRate: dv.getUint32(off + 12, true),
        byteRate: dv.getUint32(off + 16, true),
        bits: dv.getUint16(off + 22, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new MediaError("WAV data chunk before fmt chunk");
      if (fmt.audioFormat !== 1) throw new MediaError("WAV must be PCM");
      if (fmt.byteRate === 0) throw new MediaError("WAV byte rate is 0");
      const dataBytes = Math.min(size, buf.length - off - 8);
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, durationSec: dataBytes / fmt.byteRate };
    }
    off += 8 + size + (size % 2);
  }
  throw new MediaError("WAV without data chunk");
}

/** Canonical ASR input: PCM16, 16 kHz, mono. */
export function checkCanonicalWav(buf: Uint8Array, maxSeconds: number): WavInfo {
  const w = probeWav(buf);
  if (w.sampleRate !== 16000 || w.channels !== 1 || w.bitsPerSample !== 16) {
    throw new MediaError(`WAV must be 16 kHz mono 16-bit (got ${w.sampleRate} Hz, ${w.channels} ch, ${w.bitsPerSample} bit)`);
  }
  if (w.durationSec <= 0 || w.durationSec > maxSeconds) throw new MediaError(`duration ${w.durationSec.toFixed(1)} s not in (0, ${maxSeconds}]`);
  return w;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

export function checkPng(buf: Uint8Array, maxPixels: number): PngInfo {
  if (buf.length < 33) throw new MediaError("file too small");
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) throw new MediaError("not a PNG file");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (String.fromCharCode(buf[12], buf[13], buf[14], buf[15]) !== "IHDR") throw new MediaError("PNG without IHDR");
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  if (!width || !height) throw new MediaError("PNG with zero size");
  if (width * height > maxPixels) throw new MediaError(`PNG ${width}x${height} exceeds ${maxPixels} pixels`);
  return { width, height, bitDepth: buf[24], colorType: buf[25] };
}
