import { describe, it, expect } from 'vitest';
import {
  interpolate,
  buildSubmitBody,
  readSubmitConfig,
  FORM_META_KEY,
} from './SubmitBar';

describe('SubmitBar · interpolate', () => {
  const data = {
    id: 42,
    name: 'Alice',
    user: { email: 'a@x.com', tags: ['x', 'y'] },
    flag: true,
    empty: null,
  };

  it('replaces whole-string placeholders with original type', () => {
    expect(interpolate('{{id}}', data)).toBe(42);
    expect(interpolate('{{flag}}', data)).toBe(true);
    expect(interpolate('{{user}}', data)).toEqual({ email: 'a@x.com', tags: ['x', 'y'] });
  });

  it('inline placeholders are stringified into the surrounding text', () => {
    expect(interpolate('Hello {{name}}!', data)).toBe('Hello Alice!');
    expect(interpolate('/users/{{id}}/{{name}}', data)).toBe('/users/42/Alice');
  });

  it('null / undefined / missing paths become empty string for inline usage', () => {
    expect(interpolate('x={{empty}}', data)).toBe('x=');
    expect(interpolate('x={{missing}}', data)).toBe('x=');
  });

  it('recurses into arrays and objects', () => {
    const tpl = { a: '{{id}}', list: ['u-{{name}}', '{{flag}}'] };
    expect(interpolate(tpl, data)).toEqual({ a: 42, list: ['u-Alice', true] });
  });

  it('preserves $file placeholders and does not interpolate inside them', () => {
    const tpl = { avatar: { $file: '/abs/{{name}}.png', field: 'a' } };
    const out = interpolate(tpl, data) as any;
    expect(out.avatar).toEqual({ $file: '/abs/{{name}}.png', field: 'a' });
  });

  it('passes through non-string primitives untouched', () => {
    expect(interpolate(7, data)).toBe(7);
    expect(interpolate(false, data)).toBe(false);
    expect(interpolate(null, data)).toBe(null);
  });
});

describe('SubmitBar · buildSubmitBody', () => {
  const data = {
    [FORM_META_KEY]: { submit: { url: 'x' } },
    name: 'Alice',
    age: 18,
    nested: { x: 1 },
  };

  it('returns data minus __form by default', () => {
    expect(buildSubmitBody(data, { url: 'x' })).toEqual({ name: 'Alice', age: 18, nested: { x: 1 } });
  });

  it('honors bodyPath', () => {
    expect(buildSubmitBody(data, { url: 'x', bodyPath: 'nested' })).toEqual({ x: 1 });
    expect(buildSubmitBody(data, { url: 'x', bodyPath: 'name' })).toBe('Alice');
  });

  it('honors explicit body with interpolation', () => {
    const out = buildSubmitBody(data, { url: 'x', body: { who: '{{name}}', age: '{{age}}' } });
    expect(out).toEqual({ who: 'Alice', age: 18 });
  });

  it('body has higher priority than bodyPath', () => {
    const out = buildSubmitBody(data, { url: 'x', body: 'literal', bodyPath: 'nested' });
    expect(out).toBe('literal');
  });
});

describe('SubmitBar · readSubmitConfig', () => {
  it('returns null when no __form', () => {
    expect(readSubmitConfig({ a: 1 })).toBeNull();
    expect(readSubmitConfig(null)).toBeNull();
    expect(readSubmitConfig([])).toBeNull();
  });

  it('wraps a single submit object into an array', () => {
    const cfg = readSubmitConfig({ [FORM_META_KEY]: { submit: { url: 'http://a' } } });
    expect(cfg).toHaveLength(1);
    expect(cfg![0].url).toBe('http://a');
  });

  it('accepts an array and filters out invalid entries', () => {
    const cfg = readSubmitConfig({
      [FORM_META_KEY]: {
        submit: [
          { url: 'http://a' },
          { label: 'bad, no url' },
          { url: '', label: 'bad, empty url' },
          { type: 'reset', label: 'reset is ok without url' },
          { url: 'http://b', method: 'PUT' },
        ],
      },
    });
    expect(cfg).toHaveLength(3);
    expect(cfg!.map((c) => c.url || c.type)).toEqual(['http://a', 'reset', 'http://b']);
  });

  it('returns null when all entries invalid', () => {
    const cfg = readSubmitConfig({
      [FORM_META_KEY]: { submit: [{ foo: 1 }, { url: 0 }] },
    });
    expect(cfg).toBeNull();
  });
});
