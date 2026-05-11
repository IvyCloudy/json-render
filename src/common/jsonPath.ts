/**
 * 轻量 JSONPath 实现（零依赖）
 * 支持：
 *   $            根
 *   .key         成员访问
 *   ['key']      带引号成员访问（支持特殊字符）
 *   [n]          数组索引
 *   [*]          全部元素
 *   ..key        递归下降
 *   [?(@.k==v)]  简单过滤（支持 == != > >= < <= =~）
 *
 * 返回所有匹配节点的值数组。
 */
export function jsonPath(root: unknown, expr: string): unknown[] {
  const e = expr.trim();
  if (!e || e === '$') return [root];
  if (!e.startsWith('$')) throw new Error('JSONPath must start with "$"');

  const tokens = tokenize(e.slice(1));
  let ctx: unknown[] = [root];
  for (const tk of tokens) ctx = step(ctx, tk);
  return ctx;
}

type Token =
  | { kind: 'child'; name: string }
  | { kind: 'index'; n: number }
  | { kind: 'wildcard' }
  | { kind: 'descend'; name: string }
  | { kind: 'filter'; src: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '.') {
      if (src[i + 1] === '.') {
        i += 2;
        let j = i;
        while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
        tokens.push({ kind: 'descend', name: src.slice(i, j) });
        i = j;
      } else {
        i += 1;
        if (src[i] === '*') {
          tokens.push({ kind: 'wildcard' });
          i += 1;
        } else {
          let j = i;
          while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
          tokens.push({ kind: 'child', name: src.slice(i, j) });
          i = j;
        }
      }
    } else if (c === '[') {
      const end = findMatching(src, i, '[', ']');
      const inner = src.slice(i + 1, end).trim();
      if (inner === '*') tokens.push({ kind: 'wildcard' });
      else if (/^-?\d+$/.test(inner)) tokens.push({ kind: 'index', n: Number(inner) });
      else if (/^['"].*['"]$/.test(inner)) tokens.push({ kind: 'child', name: inner.slice(1, -1) });
      else if (inner.startsWith('?')) tokens.push({ kind: 'filter', src: inner.replace(/^\?\s*\(?/, '').replace(/\)$/, '') });
      else throw new Error(`Unsupported selector: [${inner}]`);
      i = end + 1;
    } else {
      throw new Error(`Unexpected char at ${i}: ${c}`);
    }
  }
  return tokens;
}

function findMatching(src: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unmatched ${open}`);
}

function step(ctx: unknown[], tk: Token): unknown[] {
  const out: unknown[] = [];
  for (const node of ctx) {
    switch (tk.kind) {
      case 'child':
        if (node && typeof node === 'object' && !Array.isArray(node) && tk.name in (node as any)) {
          out.push((node as any)[tk.name]);
        }
        break;
      case 'index':
        if (Array.isArray(node)) {
          const idx = tk.n < 0 ? node.length + tk.n : tk.n;
          if (idx >= 0 && idx < node.length) out.push(node[idx]);
        }
        break;
      case 'wildcard':
        if (Array.isArray(node)) out.push(...node);
        else if (node && typeof node === 'object') out.push(...Object.values(node as any));
        break;
      case 'descend':
        collectDescend(node, tk.name, out);
        break;
      case 'filter':
        if (Array.isArray(node)) {
          for (const el of node) if (evalFilter(tk.src, el)) out.push(el);
        } else if (node && typeof node === 'object') {
          for (const el of Object.values(node as any)) if (evalFilter(tk.src, el)) out.push(el);
        }
        break;
    }
  }
  return out;
}

function collectDescend(node: unknown, name: string, out: unknown[]) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const el of node) collectDescend(el, name, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (name in obj) out.push(obj[name]);
  for (const v of Object.values(obj)) collectDescend(v, name, out);
}

function evalFilter(src: string, el: unknown): boolean {
  // 支持形如: @.k == 'v'  @.k>=10  @.k=~/abc/
  const m = src.match(/^\s*@\.([A-Za-z0-9_$.]+)\s*(==|!=|>=|<=|>|<|=~)\s*(.+?)\s*$/);
  if (!m) return false;
  const [, keyPath, op, rawVal] = m;
  const actual = keyPath.split('.').reduce<any>((a, k) => (a && typeof a === 'object' ? a[k] : undefined), el);
  let expected: any = rawVal.trim();
  if ((expected.startsWith("'") && expected.endsWith("'")) || (expected.startsWith('"') && expected.endsWith('"'))) {
    expected = expected.slice(1, -1);
  } else if (expected === 'true') expected = true;
  else if (expected === 'false') expected = false;
  else if (expected === 'null') expected = null;
  else if (!isNaN(Number(expected))) expected = Number(expected);

  switch (op) {
    case '==': return actual == expected; // eslint-disable-line eqeqeq
    case '!=': return actual != expected; // eslint-disable-line eqeqeq
    case '>':  return actual > expected;
    case '<':  return actual < expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '=~': {
      try {
        const inner = String(expected).replace(/^\/|\/$/g, '');
        return new RegExp(inner).test(String(actual));
      } catch { return false; }
    }
  }
  return false;
}
