/**
 * A look at a file before it is decoded: is it a sound file at all, and is it small enough to
 * open here? Decoding turns every second of a stereo song into about 350 KB of samples, so a
 * one hour mp3 would need over a gigabyte and crash a phone's tab.
 */

/** Largest file opened, in bytes. */
export const MAX_SONG_BYTES = 150 * 1024 * 1024;

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'mp4',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'wave',
  'flac',
  'aif',
  'aiff',
  'caf',
  'webm',
  'weba',
]);

/** Whether this looks like audio: 'unknown' when the browser gave no useful type. */
export function soundKind(file: Pick<File, 'name' | 'type'>): 'audio' | 'not-audio' | 'unknown' {
  const type = file.type.toLowerCase();
  // Video files carry a sound track that browsers can decode too.
  if (type.startsWith('audio/') || type.startsWith('video/') || type === 'application/ogg') {
    return 'audio';
  }
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (type === '' || type === 'application/octet-stream') return 'unknown';
  return 'not-audio';
}

/** A short message when the file cannot be opened, or null to go ahead and decode it. */
export function checkSongFile(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (soundKind(file) === 'not-audio') {
    return `${file.name} is not a sound file. Try an mp3, ogg, wav or m4a file.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_SONG_BYTES) {
    const mb = Math.round(file.size / (1024 * 1024));
    return `${file.name} is too large to open here (${mb} MB). Try a file under 150 MB.`;
  }
  return null;
}

/** The loudest sample, to tell a silent file from a quiet one. */
export function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] as number);
    if (v > max) max = v;
  }
  return max;
}

/** Below this peak (about -80 dB) a song is treated as silent. */
export const SILENCE_PEAK = 1e-4;
