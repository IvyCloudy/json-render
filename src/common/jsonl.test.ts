import { describe, it, expect } from 'vitest';
import { jsonlParse, jsonlStringify, isJsonlFileName } from './jsonl';

describe('jsonl', () => {
  it('parses multi lines', () => {
    const text = '{"id":1}\n{"id":2}\n\n{"id":3}';
    expect(jsonlParse(text).items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('throws with line number on bad json', () => {
    const text = '{"ok":1}\n{not-json}\n';
    expect(() => jsonlParse(text)).toThrow(/line 2/);
  });

  it('stringifies items one per line', () => {
    expect(jsonlStringify([{ a: 1 }, 2, 'x'])).toBe('{"a":1}\n2\n"x"\n');
  });

  it('round-trips', () => {
    const items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }];
    expect(jsonlParse(jsonlStringify(items)).items).toEqual(items);
  });

  it('recognizes extensions', () => {
    expect(isJsonlFileName('foo.jsonl')).toBe(true);
    expect(isJsonlFileName('foo.NDJSON')).toBe(true);
    expect(isJsonlFileName('foo.json')).toBe(false);
  });
});
