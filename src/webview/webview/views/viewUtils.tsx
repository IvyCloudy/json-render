import React from 'react';

export interface ViewProps {
  data: unknown;
  search: string;
  onChange: (next: unknown) => void;
  onError: (msg: string) => void;
}

/**
 * 工具函数：按路径不可变地更新嵌套对象
 * path: ['foo', 0, 'bar']
 */
export function setByPath(obj: any, path: (string | number)[], value: any): any {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(obj)) {
    const next = obj.slice();
    next[head as number] = setByPath(obj[head as number], rest, value);
    return next;
  }
  const next = { ...(obj ?? {}) };
  next[head as string] = setByPath(obj?.[head as string], rest, value);
  return next;
}

/**
 * 按路径读取嵌套对象：支持字符串路径("a.b[0].c")或数组路径
 * 任一段不存在时返回 undefined。
 */
export function getByPath(obj: any, path: string | (string | number)[]): any {
  const segs: (string | number)[] = Array.isArray(path)
    ? path
    : parsePathExpr(path);
  let cur: any = obj;
  for (const seg of segs) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[seg as any];
  }
  return cur;
}

/** 把 "foo.bar[0].baz" 这类表达式解析为分段路径 */
export function parsePathExpr(expr: string): (string | number)[] {
  if (!expr) return [];
  const out: (string | number)[] = [];
  const re = /([^.\[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    if (m[2] !== undefined) out.push(Number(m[2]));
    else out.push(m[1]);
  }
  return out;
}

export function deleteByPath(obj: any, path: (string | number)[]): any {
  if (path.length === 0) return obj;
  const [head, ...rest] = path;
  if (rest.length === 0) {
    if (Array.isArray(obj)) {
      const next = obj.slice();
      next.splice(head as number, 1);
      return next;
    }
    const next = { ...(obj ?? {}) };
    delete next[head as string];
    return next;
  }
  return setByPath(obj, [head], deleteByPath(obj?.[head as any], rest));
}

/** 判断一个值是否与搜索关键字匹配（作用于原始值和 key） */
export function matchSearch(value: unknown, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  if (value === null || value === undefined) return 'null'.includes(q);
  if (typeof value === 'object') return false;
  return String(value).toLowerCase().includes(q);
}

/** 把文本中匹配的部分用 <mark> 高亮 */
export const Highlight: React.FC<{ text: string; search: string }> = ({ text, search }) => {
  if (!search) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = search.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="jr-hit">{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </>
  );
};

/**
 * 把字符串根据原值类型解析回去。
 * 对于 number / boolean，仅在能严格匹配时才返回目标类型；否则原样返回字符串，
 * 由调用方（如 TableView.setAtPathOrdered）决定是否弹窗提示类型不匹配。
 */
export function coerce(raw: string, original: unknown): unknown {
  if (typeof original === 'number') {
    if (raw.trim() === '') return raw;
    if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) return raw;
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (typeof original === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    // 非法输入：返回原字符串，让上层能检测到类型不匹配并弹窗提示
    return raw;
  }
  if (original === null) {
    return raw === '' || raw === 'null' ? null : raw;
  }
  return raw;
}
