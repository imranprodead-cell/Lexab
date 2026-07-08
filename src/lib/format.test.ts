import { describe, expect, it } from 'vitest';
import { formatFileSize, initialsOf } from './format';

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });
  it('formats kilobytes', () => {
    expect(formatFileSize(48 * 1024)).toBe('48 KB');
  });
  it('formats megabytes', () => {
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

describe('initialsOf', () => {
  it('takes first + last initial', () => {
    expect(initialsOf('Aisha Rahman')).toBe('AR');
  });
  it('handles a single name', () => {
    expect(initialsOf('Aisha')).toBe('AI');
  });
  it('handles the "A. Rahman" format', () => {
    expect(initialsOf('A. Rahman')).toBe('AR');
  });
  it('falls back for empty input', () => {
    expect(initialsOf('   ')).toBe('?');
  });
});
