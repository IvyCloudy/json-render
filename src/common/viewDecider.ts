/**
 * 视图决策器
 * -----------------------------------------------------------------------------
 * 根据 JSON 数据结构自动选择最合适的视图（Tree / Table / Form / Chart / Card）。
 *
 * 决策优先级：P0 显式声明 > P1 根类型推断 > P2 子特征加权 > P3 兜底
 *
 *  P0  数据中出现保留字段 `__view` / `$schema` / `children|items|leaf` 等
 *  P1  根类型：Array<Object 同质> → Table；Array<primitive> → Table；
 *              扁平 Object → Form；嵌套 Object → Tree
 *  P2  Object 中出现典型树字段 → 升格 Tree
 *  P3  兜底 → Tree
 */

export type ViewKind = 'tree' | 'table' | 'form' | 'chart' | 'card' | 'composite';

export interface DecideOptions {
  /** 文件类型（JSONL 强制 Table） */
  fileKind?: 'json' | 'jsonl';
  /** 是否存在外部 JSON Schema */
  hasSchema?: boolean;
  /** 用户在插件配置里强制的视图（最高优先级，仅用于调试/逃生） */
  override?: ViewKind | '';
  /** 同质数组判断阈值（0~1），默认 0.7 */
  homogeneityThreshold?: number;
}

export interface AlternativeView {
  view: ViewKind;
  /** 这个副视图为什么有意义（hover 提示用） */
  reason: string;
}

export interface DecideResult {
  view: ViewKind;
  /** 命中规则简述，展示在 UI badge 里 */
  reason: string;
  /**
   * 可选的副视图候选列表，UI 层可渲染为"快捷切换徽章"。
   * 只包含"确实对当前数据有意义"的视图，且不包含主视图本身。
   */
  alternatives: AlternativeView[];
}

/** 保留字段名：用户可通过这些字段显式指定视图 */
const VIEW_KEY_CANDIDATES = ['__view', '$view', '_render'];

/**
 * 元配置字段：这类字段是"给渲染器看的配置"，不属于业务数据。
 * 判定视图类型 / 统计结构时必须忽略它们，否则会让整棵对象看起来像
 * "嵌套对象" 而被错误地判成 Composite / Tree。
 *
 * 目前包含：
 *   - __form : 表单提交、鉴权等配置（FormView 读取）
 */
const META_KEYS = ['__form'];

function isMetaKey(k: string): boolean {
  return META_KEYS.includes(k);
}

/** 返回 obj 的所有非 meta entries（遍历结构用） */
function businessEntries(obj: Record<string, unknown>): [string, unknown][] {
  return Object.entries(obj).filter(([k]) => !isMetaKey(k));
}

/** 典型"树"字段名 */
const TREE_CHILD_KEYS = ['children', 'nodes', 'items', 'leaf'];

/** 典型"图表"字段名 */
const CHART_KEYS = ['series', 'dataset', 'datasets'];

/** 典型"卡片"字段名 */
const CARD_KEYS = ['cards'];

const VALID_VIEWS: ViewKind[] = ['tree', 'table', 'form', 'chart', 'card', 'composite'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 读取对象上的"显式视图"字段，返回合法 ViewKind 或 null */
function readExplicitView(obj: Record<string, unknown>): ViewKind | null {
  for (const k of VIEW_KEY_CANDIDATES) {
    const raw = obj[k];
    if (typeof raw === 'string' && VALID_VIEWS.includes(raw.toLowerCase() as ViewKind)) {
      return raw.toLowerCase() as ViewKind;
    }
  }
  return null;
}

/** 判断数组中对象"同质度"：所有对象 key 的并集里，出现在多数对象中的比例 */
export function homogeneity(arr: unknown[]): number {
  const objs = arr.filter(isPlainObject) as Record<string, unknown>[];
  if (objs.length === 0) return 0;
  const keyCount = new Map<string, number>();
  for (const o of objs) {
    for (const k of Object.keys(o)) {
      keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
    }
  }
  if (keyCount.size === 0) return 0;
  // 指标：覆盖率 >= 50% 的 key 数 / 总 key 数
  let shared = 0;
  const half = Math.ceil(objs.length / 2);
  for (const cnt of keyCount.values()) {
    if (cnt >= half) shared += 1;
  }
  return shared / keyCount.size;
}

/** 对象所有值都是基本类型（非 object/array）→ 扁平；忽略 meta 键 */
function isFlatObject(obj: Record<string, unknown>): boolean {
  return businessEntries(obj).every(([, v]) => v === null || typeof v !== 'object');
}

/**
 * 分析一个嵌套对象是否适合用 Composite 视图展示：
 *   - 至少包含 1 个「有意义的容器字段」：对象数组 / 嵌套对象 / 非空数组
 *   - 且顶层 key 数 ≥ 2（单键退化为直接用容器自己的视图更好）
 * 返回命中理由，用于 UI badge。
 */
function analyzeComposite(
  obj: Record<string, unknown>,
  _threshold: number,
): { qualifies: boolean; reason: string } {
  const entries = businessEntries(obj);
  if (entries.length < 2) return { qualifies: false, reason: '' };

  let objectArrays = 0;
  let nestedObjects = 0;
  let primitiveArrays = 0;

  for (const [, v] of entries) {
    if (Array.isArray(v)) {
      if (v.length > 0 && v.every(isPlainObject)) objectArrays += 1;
      else if (v.length > 0) primitiveArrays += 1;
    } else if (isPlainObject(v)) {
      nestedObjects += 1;
    }
  }

  const containers = objectArrays + nestedObjects + primitiveArrays;
  if (containers === 0) return { qualifies: false, reason: '' };

  const parts: string[] = [];
  if (objectArrays) parts.push(`${objectArrays} table(s)`);
  if (nestedObjects) parts.push(`${nestedObjects} object(s)`);
  if (primitiveArrays) parts.push(`${primitiveArrays} list(s)`);
  return {
    qualifies: true,
    reason: `Composite root: ${parts.join(' + ')} → Composite`,
  };
}

/** 判断一个值是否"数值型"，null/undefined 不算 */
function isNumericLike(v: unknown): boolean {
  if (typeof v === 'number' && Number.isFinite(v)) return true;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return true;
  return false;
}

/** 统计对象数组中"数值列"：该列在多数行中都是数值 */
function countNumericColumns(arr: Record<string, unknown>[]): number {
  if (arr.length === 0) return 0;
  const colCount = new Map<string, { num: number; total: number }>();
  for (const row of arr) {
    for (const [k, v] of Object.entries(row)) {
      const slot = colCount.get(k) ?? { num: 0, total: 0 };
      slot.total += 1;
      if (isNumericLike(v)) slot.num += 1;
      colCount.set(k, slot);
    }
  }
  let numeric = 0;
  for (const { num, total } of colCount.values()) {
    // 出现在一半以上行里且这些行全为数值
    if (total >= Math.ceil(arr.length / 2) && num / total >= 0.8) numeric += 1;
  }
  return numeric;
}

/**
 * 为给定数据计算"可选副视图"列表（不会包含 primary 自身）。
 * 规则：
 *   - 对象数组里存在 ≥1 个数值列且行数 ≥3 → Chart
 *   - Array<number> 长度 ≥ 3                → Chart
 *   - 同质度在 [0.3, 0.9] 区间的对象数组    → Card（另一种阅读角度）
 *   - 行数 ≥ 2 的对象数组                   → Card（当主视图是 Table 时）
 *   - 非数组根                              → Tree（作为"原始视图"逃生入口）
 *
 * 注意：数组根（Table / Card / Chart 主视图）下不暴露 Tree 切换项，
 *       因为行级结构用 Tree 浏览可读性差。
 */
export function scoreAlternatives(
  data: unknown,
  primary: ViewKind,
  opts: { hasSchema?: boolean } = {},
): AlternativeView[] {
  const result: AlternativeView[] = [];
  const push = (view: ViewKind, reason: string) => {
    if (view === primary) return;
    if (result.some((a) => a.view === view)) return;
    result.push({ view, reason });
  };

  if (Array.isArray(data) && data.length > 0) {
    const objs = data.filter(isPlainObject) as Record<string, unknown>[];
    if (objs.length === data.length) {
      const numericCols = countNumericColumns(objs);
      if (numericCols >= 1 && objs.length >= 3) {
        push('chart', `${numericCols} numeric column(s) · ${objs.length} rows → Chart`);
      }
      const h = homogeneity(objs);
      if (h < 0.9 && objs.length >= 1) {
        push('card', `Heterogeneous objects (${Math.round(h * 100)}%) → Card`);
      }
      if (primary === 'table' && objs.length >= 2) {
        push('card', 'Same rows as Card');
      }
    }
    const allNum = data.every((v) => typeof v === 'number' && Number.isFinite(v));
    if (allNum && data.length >= 3) {
      push('chart', `Numeric series (${data.length}) → Chart`);
    }
  }

  if (isPlainObject(data)) {
    // 带 schema 的对象，Form 已是主视图；对扁平对象追加 Form 以便从 Tree 切换
    if (opts.hasSchema && primary !== 'form') {
      push('form', 'Schema available → Form');
    }
    // 含数值型数组的对象 → 可用 Chart 呈现
    const numericArrayKey = Object.entries(data).find(
      ([, v]) => Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number'),
    );
    if (numericArrayKey) {
      push('chart', `Field "${numericArrayKey[0]}" is numeric array → Chart`);
    }
  }

  // Tree 作为"原始视图"逃生入口：仅对非数组根数据提供。
  // 数组根（Table / Card / Chart 主视图）下不再暴露 Tree 切换项，
  // 因为行级结构用 Tree 浏览可读性很差，且容易误用。
  // Form 主视图也不再暴露 Tree 切换项：Form 面向"一个可编辑的业务对象"，
  // 切到 Tree 只会让用户看到一份只读原始数据，没有增益，且容易误操作。
  if (!Array.isArray(data) && primary !== 'form') {
    push('tree', 'Raw tree view');
  }

  return result;
}

export function decideView(data: unknown, opts: DecideOptions = {}): DecideResult {
  const primary = decidePrimaryView(data, opts);
  const alternatives = scoreAlternatives(data, primary.view, { hasSchema: opts.hasSchema });
  return { ...primary, alternatives };
}

/** 内部：仅计算主视图（不含 alternatives），方便测试与复用 */
function decidePrimaryView(
  data: unknown,
  opts: DecideOptions,
): { view: ViewKind; reason: string } {
  const threshold = opts.homogeneityThreshold ?? 0.7;

  // P0-0: 配置项强制
  if (opts.override && VALID_VIEWS.includes(opts.override)) {
    return { view: opts.override, reason: `Override: ${opts.override}` };
  }

  // P0-1: JSONL 一律 Table
  if (opts.fileKind === 'jsonl') {
    return { view: 'table', reason: 'JSONL → Table' };
  }

  // P0-2: 带 Schema 的对象 → Form
  if (opts.hasSchema && isPlainObject(data)) {
    return { view: 'form', reason: 'JSON Schema → Form' };
  }

  // P0-3: 显式 __view / $view / _render
  if (isPlainObject(data)) {
    const explicit = readExplicitView(data);
    if (explicit) return { view: explicit, reason: `Explicit "__view": "${explicit}"` };

    // 内嵌 $schema
    if ('$schema' in data) {
      return { view: 'form', reason: 'Inline $schema → Form' };
    }

    // P0-4: 内嵌 __form（表单提交/鉴权配置）→ Form
    // 业务数据里一旦声明了 __form，用户意图显然是把整个根对象当作表单编辑。
    if (isPlainObject((data as Record<string, unknown>).__form)) {
      return { view: 'form', reason: 'Has __form → Form' };
    }
  }

  // P1/P2: 根类型推断
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { view: 'table', reason: 'Empty array → Table' };
    }
    const allObj = data.every(isPlainObject);
    if (allObj) {
      const h = homogeneity(data);
      if (h >= threshold) {
        return {
          view: 'table',
          reason: `Array of homogeneous objects (${Math.round(h * 100)}%) → Table`,
        };
      }
      return {
        view: 'card',
        reason: `Array of heterogeneous objects (${Math.round(h * 100)}%) → Card`,
      };
    }
    const allPrim = data.every((v) => v === null || typeof v !== 'object');
    if (allPrim) {
      return { view: 'table', reason: 'Array of primitives → Table' };
    }
    return { view: 'tree', reason: 'Mixed array → Tree' };
  }

  if (isPlainObject(data)) {
    // 典型树字段优先（忽略 meta 键本身，但 meta 不可能是树字段，这里只是对齐风格）
    const hasTreeKey = TREE_CHILD_KEYS.some((k) => !isMetaKey(k) && k in data);
    if (hasTreeKey) {
      return { view: 'tree', reason: 'Has children/items/leaf → Tree' };
    }
    // 典型图表字段
    if (CHART_KEYS.some((k) => Array.isArray((data as any)[k]))) {
      return { view: 'chart', reason: 'Has series/dataset → Chart' };
    }
    // 典型卡片字段
    if (CARD_KEYS.some((k) => Array.isArray((data as any)[k]))) {
      return { view: 'card', reason: 'Has cards → Card' };
    }
    // 扁平对象 → Form（meta 字段已被 isFlatObject 忽略）
    if (isFlatObject(data)) {
      return { view: 'form', reason: 'Flat object → Form' };
    }
    // 混合根对象 → Composite（把内部容器字段各自渲染成最合适的视图）
    const composite = analyzeComposite(data, threshold);
    if (composite.qualifies) {
      return {
        view: 'composite',
        reason: composite.reason,
      };
    }
    // 兜底：嵌套 → Tree
    return { view: 'tree', reason: 'Nested object → Tree' };
  }

  // P3: primitive / null / undefined
  return { view: 'tree', reason: 'Primitive → Tree' };
}
