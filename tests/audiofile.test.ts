import { describe, expect, it } from 'vitest';
import { MAX_SONG_BYTES, SILENCE_PEAK, checkSongFile, peak, soundKind } from '../src/app/audiofile';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('soundKind', () => {
  it('trusts audio and video types', () => {
    expect(soundKind(file('a.mp3', 'audio/mpeg'))).toBe('audio');
    expect(soundKind(file('clip.mov', 'video/quicktime'))).toBe('audio');
    expect(soundKind(file('a.ogg', 'application/ogg'))).toBe('audio');
  });

  it('falls back on the extension when the type is missing or generic', () => {
    expect(soundKind(file('Song.FLAC', ''))).toBe('audio');
    expect(soundKind(file('a.opus', 'application/octet-stream'))).toBe('audio');
    expect(soundKind(file('mystery', ''))).toBe('unknown');
  });

  it('turns away other files', () => {
    expect(soundKind(file('notes.txt', 'text/plain'))).toBe('not-audio');
    expect(soundKind(file('photo.jpg', 'image/jpeg'))).toBe('not-audio');
    expect(soundKind(file('book.pdf', 'application/pdf'))).toBe('not-audio');
  });
});

describe('checkSongFile', () => {
  it('lets a normal song through', () => {
    expect(checkSongFile(file('a.mp3', 'audio/mpeg', 8e6))).toBeNull();
    expect(checkSongFile(file('mystery', '', 8e6))).toBeNull();
  });

  it('says what is wrong, naming the file', () => {
    expect(checkSongFile(file('notes.txt', 'text/plain'))).toBe(
      'notes.txt is not a sound file. Try an mp3, ogg, wav or m4a file.',
    );
    expect(checkSongFile(file('a.mp3', 'audio/mpeg', 0))).toBe('a.mp3 is empty.');
    expect(checkSongFile(file('mix.mp3', 'audio/mpeg', MAX_SONG_BYTES + 1))).toContain(
      'mix.mp3 is too large to open here (150 MB)',
    );
  });
});

describe('peak', () => {
  it('finds the loudest sample either side of zero', () => {
    expect(peak(new Float32Array([0, 0.2, -0.5, 0.1]))).toBeCloseTo(0.5);
    expect(peak(new Float32Array(100))).toBe(0);
    expect(peak(new Float32Array([1e-5, -2e-5]))).toBeLessThan(SILENCE_PEAK);
  });
});
