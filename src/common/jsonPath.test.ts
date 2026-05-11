import { describe, it, expect } from 'vitest';
import { jsonPath } from './jsonPath';

const store = {
  store: {
    book: [
      { title: 'A', price: 8.95, category: 'fiction' },
      { title: 'B', price: 12.99, category: 'fiction' },
      { title: 'C', price: 5, category: 'reference' },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
};

describe('jsonPath', () => {
  it('returns root on $', () => {
    expect(jsonPath(store, '$')).toEqual([store]);
  });

  it('resolves dot-child', () => {
    expect(jsonPath(store, '$.store.bicycle.color')).toEqual(['red']);
  });

  it('resolves bracket-index', () => {
    expect(jsonPath(store, '$.store.book[0].title')).toEqual(['A']);
    expect(jsonPath(store, "$.store.book[-1]['title']")).toEqual(['C']);
  });

  it('resolves wildcard', () => {
    const titles = jsonPath(store, '$.store.book[*].title');
    expect(titles).toEqual(['A', 'B', 'C']);
  });

  it('resolves recursive descend', () => {
    const prices = jsonPath(store, '$..price');
    expect(prices.sort()).toEqual([12.99, 19.95, 5, 8.95].sort());
  });

  it('filters with comparison', () => {
    const cheap = jsonPath(store, '$.store.book[?(@.price<10)].title');
    expect(cheap).toEqual(['A', 'C']);
  });

  it('filters with equals on string', () => {
    const fics = jsonPath(store, "$.store.book[?(@.category=='fiction')].title");
    expect(fics).toEqual(['A', 'B']);
  });

  it('throws on invalid expr', () => {
    expect(() => jsonPath(store, 'store.book')).toThrow(/must start with/);
  });
});
