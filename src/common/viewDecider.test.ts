import { describe, it, expect } from 'vitest';
import { decideView, homogeneity } from './viewDecider';

describe('viewDecider', () => {
  // ---------------- P0 显式声明 ----------------
  it('override 强制覆盖一切', () => {
    const r = decideView({ any: 1 }, { override: 'chart' });
    expect(r.view).toBe('chart');
  });

  it('JSONL → Table', () => {
    expect(decideView([{ a: 1 }], { fileKind: 'jsonl' }).view).toBe('table');
  });

  it('数据内嵌 __view 字段显式指定', () => {
    expect(decideView({ __view: 'chart', x: 1 }).view).toBe('chart');
    expect(decideView({ __view: 'card', x: 1 }).view).toBe('card');
  });

  it('__view 非法值被忽略，走正常推断', () => {
    expect(decideView({ __view: 'xxx', a: 1, b: 2 }).view).toBe('form');
  });

  // ---------------- P1 根类型 ----------------
  it('同质对象数组 → Table', () => {
    const arr = [
      { id: 1, name: 'a', age: 10 },
      { id: 2, name: 'b', age: 20 },
      { id: 3, name: 'c', age: 30 },
    ];
    expect(decideView(arr).view).toBe('table');
  });

  it('异质对象数组 → Card', () => {
    const arr = [
      { id: 1, title: 'a' },
      { foo: 'x', bar: 'y' },
      { hello: 'world' },
    ];
    expect(decideView(arr).view).toBe('card');
  });

  it('基本类型数组 → Table', () => {
    expect(decideView([1, 2, 3]).view).toBe('table');
    expect(decideView(['a', 'b']).view).toBe('table');
  });

  it('空数组 → Table', () => {
    expect(decideView([]).view).toBe('table');
  });

  it('扁平对象 → Form', () => {
    expect(decideView({ title: 'x', count: 3, active: true }).view).toBe('form');
  });

  it('嵌套对象（混合容器）→ Composite', () => {
    expect(decideView({ user: { id: 1, name: 'x' }, list: [1, 2] }).view).toBe('composite');
  });

  it('单个容器字段的对象 → Tree（不会误升为 Composite）', () => {
    expect(decideView({ user: { id: 1, name: 'x' } }).view).toBe('tree');
  });

  // ---------------- P2 子特征加权 ----------------
  it('含 children 的对象 → Tree', () => {
    expect(decideView({ name: 'root', children: [{ name: 'a' }] }).view).toBe('tree');
  });

  it('含 leaf 字段 → Tree', () => {
    expect(decideView({ name: 'x', leaf: true }).view).toBe('tree');
  });

  it('含 series 数组 → Chart', () => {
    expect(decideView({ title: 'x', series: [1, 2, 3] }).view).toBe('chart');
  });

  // ---------------- P3 兜底 ----------------
  it('primitive → Tree', () => {
    expect(decideView(42).view).toBe('tree');
    expect(decideView('hello').view).toBe('tree');
    expect(decideView(null).view).toBe('tree');
  });

  // ---------------- homogeneity ----------------
  it('homogeneity 计算正确', () => {
    expect(homogeneity([{ a: 1 }, { a: 2 }, { a: 3 }])).toBe(1);
    expect(homogeneity([])).toBe(0);
    // 3 个 key 中只有 a 出现在多数对象
    const h = homogeneity([{ a: 1, b: 2 }, { a: 3, c: 4 }, { a: 5, d: 6 }]);
    expect(h).toBeCloseTo(1 / 4);
  });

  // ---------------- alternatives（方案 A 副视图） ----------------
  it('alternatives 不包含主视图自身', () => {
    const r = decideView([{ id: 1, v: 10 }, { id: 2, v: 20 }, { id: 3, v: 30 }]);
    expect(r.view).toBe('table');
    expect(r.alternatives.some((a) => a.view === 'table')).toBe(false);
  });

  it('对象数组含数值列且行数≥3 → alternatives 含 Chart', () => {
    const r = decideView([
      { id: 1, score: 10 },
      { id: 2, score: 20 },
      { id: 3, score: 30 },
    ]);
    expect(r.view).toBe('table');
    expect(r.alternatives.some((a) => a.view === 'chart')).toBe(true);
    // Table 主视图下 Card 也应是一个候选
    expect(r.alternatives.some((a) => a.view === 'card')).toBe(true);
  });

  it('对象数组无数值列 → alternatives 不含 Chart', () => {
    const r = decideView([
      { id: 'a1', name: 'a', city: 'x' },
      { id: 'a2', name: 'b', city: 'y' },
      { id: 'a3', name: 'c', city: 'z' },
    ]);
    expect(r.view).toBe('table');
    expect(r.alternatives.some((a) => a.view === 'chart')).toBe(false);
  });

  it('含数值数组字段的对象 → alternatives 含 Chart', () => {
    const r = decideView({ title: 'x', scores: [1, 2, 3, 4, 5] });
    // 根是混合容器对象 → 主视图 Composite
    expect(r.view).toBe('composite');
    expect(r.alternatives.some((a) => a.view === 'chart')).toBe(true);
  });

  it('混合根对象（对象数组 + 基本值 + 嵌套对象）→ Composite', () => {
    const r = decideView({
      store: {
        book: [
          { category: 'reference', author: 'A', title: 'T1', price: 8.95 },
          { category: 'fiction', author: 'B', title: 'T2', price: 12.99 },
        ],
        bicycle: { color: 'red', price: 19.95 },
      },
      expensive: 10,
    });
    expect(r.view).toBe('composite');
  });

  it('Form 主视图时 alternatives 不含 Tree（Form 面向可编辑对象，切 Tree 无增益）', () => {
    const r = decideView({ a: 1, b: 2, c: 3 });
    expect(r.view).toBe('form');
    expect(r.alternatives.some((a) => a.view === 'tree')).toBe(false);
  });

  it('Composite 主视图下 Tree 仍作为兜底副视图存在', () => {
    const r = decideView({ user: { id: 1, name: 'x' }, list: [1, 2] });
    expect(r.view).toBe('composite');
    expect(r.alternatives.some((a) => a.view === 'tree')).toBe(true);
  });

  it('主视图是 Tree 时 alternatives 不再重复 Tree', () => {
    const r = decideView({ name: 'root', children: [{ name: 'a' }] });
    expect(r.view).toBe('tree');
    expect(r.alternatives.some((a) => a.view === 'tree')).toBe(false);
  });

  it('纯数字数组 → 主 Table，alternatives 含 Chart', () => {
    const r = decideView([10, 20, 30, 40]);
    expect(r.view).toBe('table');
    expect(r.alternatives.some((a) => a.view === 'chart')).toBe(true);
  });

  it('数组根的 alternatives 不包含 Tree', () => {
    const objArr = decideView([
      { id: 1, name: 'a', age: 10 },
      { id: 2, name: 'b', age: 20 },
      { id: 3, name: 'c', age: 30 },
    ]);
    expect(objArr.view).toBe('table');
    expect(objArr.alternatives.some((a) => a.view === 'tree')).toBe(false);

    const numArr = decideView([10, 20, 30, 40]);
    expect(numArr.alternatives.some((a) => a.view === 'tree')).toBe(false);

    const heteroArr = decideView([
      { id: 1, title: 'a' },
      { foo: 'x', bar: 'y' },
      { hello: 'world' },
    ]);
    expect(heteroArr.view).toBe('card');
    expect(heteroArr.alternatives.some((a) => a.view === 'tree')).toBe(false);
  });

  // ---------------- __form meta 字段 ----------------
  it('根对象含 __form → Form（即使其它字段让它看起来像 Composite）', () => {
    const r = decideView({
      __form: { submit: [{ label: 'Save', url: '/x', method: 'POST' }] },
      name: 'Alice',
      age: 18,
      lastResponse: null,
    });
    expect(r.view).toBe('form');
    expect(r.reason).toMatch(/__form/);
  });

  it('__form 不会让扁平对象退化为 Composite', () => {
    const r = decideView({
      __form: { submit: { url: '/x', method: 'POST' } },
      title: 'x',
      count: 3,
      active: true,
    });
    expect(r.view).toBe('form');
  });

  // ---------------- formConfig / formData ----------------
  it('含 formConfig 数组 → Form', () => {
    const r = decideView({
      formConfig: [{ keyName: 'name', component: 'Input' }],
      name: 'Alice',
    });
    expect(r.view).toBe('form');
    expect(r.reason).toMatch(/formConfig/);
  });

  it('含 formData 对象 → Form', () => {
    const r = decideView({
      formData: { name: 'Alice', age: 18 },
    });
    expect(r.view).toBe('form');
    expect(r.reason).toMatch(/formData/);
  });

  it('formConfig + formData 同时存在 → Form', () => {
    const r = decideView({
      formConfig: [{ keyName: 'name', component: 'Input' }],
      formData: { name: 'Alice' },
    });
    expect(r.view).toBe('form');
  });
});
