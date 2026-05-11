import { describe, it, expect } from 'vitest';
import { setByPath, deleteByPath, coerce, matchSearch } from './viewUtils';

describe('viewUtils', () => {
  describe('setByPath', () => {
    it('sets nested object field', () => {
      const src = { a: { b: 1 } };
      const next = setByPath(src, ['a', 'b'], 2);
      expect(next).toEqual({ a: { b: 2 } });
      expect(src).toEqual({ a: { b: 1 } }); // immutable
    });

    it('sets array element', () => {
      const src = { list: [1, 2, 3] };
      const next = setByPath(src, ['list', 1], 20);
      expect(next).toEqual({ list: [1, 20, 3] });
    });

    it('returns value when path is empty', () => {
      expect(setByPath({}, [], { hello: 1 })).toEqual({ hello: 1 });
    });
  });

  describe('deleteByPath', () => {
    it('removes object key', () => {
      const next = deleteByPath({ a: 1, b: 2 }, ['a']);
      expect(next).toEqual({ b: 2 });
    });
    it('removes array element', () => {
      const next = deleteByPath({ list: [1, 2, 3] }, ['list', 1]);
      expect(next).toEqual({ list: [1, 3] });
    });
  });

  describe('coerce', () => {
    it('keeps type for number', () => {
      expect(coerce('42', 10)).toBe(42);
      expect(coerce('abc', 10)).toBe('abc');
      // 非纯数字串应保留为字符串（上层据此弹窗提示）
      expect(coerce('2a', 10)).toBe('2a');
      expect(coerce('', 10)).toBe('');
    });
    it('booleanizes', () => {
      expect(coerce('true', false)).toBe(true);
      expect(coerce('false', true)).toBe(false);
      // boolean 列非法输入：返回原字符串，便于上层检测类型不匹配并弹窗
      expect(coerce('yes', false)).toBe('yes');
      expect(coerce('1', true)).toBe('1');
      expect(coerce('', false)).toBe('');
    });
    it('converts null placeholder', () => {
      expect(coerce('null', null)).toBe(null);
      expect(coerce('', null)).toBe(null);
    });
  });

  describe('matchSearch', () => {
    it('case insensitive contains', () => {
      expect(matchSearch('Hello World', 'HELLO')).toBe(true);
      expect(matchSearch(42, '4')).toBe(true);
      expect(matchSearch({}, 'anything')).toBe(false);
      expect(matchSearch(null, 'null')).toBe(true);
    });
    it('empty search matches all', () => {
      expect(matchSearch('x', '')).toBe(true);
    });
  });
});
