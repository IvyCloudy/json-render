import { describe, it, expect } from 'vitest';
import { csvParse, csvStringify } from './csv';

describe('csv', () => {
  it('parses simple csv', () => {
    const rows = csvParse('name,age\nAlice,30\nBob,25');
    expect(rows).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ]);
  });

  it('handles quoted fields with commas and newlines', () => {
    const text = 'a,b\n"x,y","line1\nline2"\n';
    expect(csvParse(text)).toEqual([{ a: 'x,y', b: 'line1\nline2' }]);
  });

  it('handles escaped quotes', () => {
    const rows = csvParse('k\n"he said ""hi"""');
    expect(rows).toEqual([{ k: 'he said "hi"' }]);
  });

  it('round-trip', () => {
    const data = [
      { id: 1, name: 'A,B', desc: 'line1\nline2' },
      { id: 2, name: 'C"D', desc: 'ok' },
    ];
    const text = csvStringify(data as any);
    const parsed = csvParse(text);
    expect(parsed).toEqual([
      { id: '1', name: 'A,B', desc: 'line1\nline2' },
      { id: '2', name: 'C"D', desc: 'ok' },
    ]);
  });

  it('stringify returns empty for empty array', () => {
    expect(csvStringify([])).toBe('');
  });
});
