import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Webview 内的 undo/redo 历史管理。
 *
 * 设计：
 * - current: 当前 data（由外部 state 同步进来）
 * - past:    历史快照栈（最老在数组前端）
 * - future:  redo 栈（最近一次被 undo 的快照在数组末尾）
 *
 * 触发场景：
 * 1. 用户在视图里编辑 → onChange(next) → commit(next)
 *    将旧值压入 past，清空 future。
 * 2. 插件回响 sync（"这就是我刚 postUpdate 的值"）→ acknowledge()
 *    不改动历史栈（仅用于对齐 current）。
 * 3. 外部修改（文本编辑器手动改、git checkout、其他插件）→ resetTo(data)
 *    清空 past/future，视为新起点。
 * 4. undo() / redo()
 *    在栈间移动，并通过 onPush 回调把目标值 post 出去。
 *
 * 历史粒度：按 data 引用 / JSON 字符串去重。
 * 深拷贝策略：外部传入的 data 由 React state 管理，本身是不可变更新，
 *            故直接保存引用即可，无需深拷贝。
 */

const MAX_HISTORY = 200;

export interface UndoApi {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** 用户在视图里产生的新编辑。返回需要对外广播的值（通常就是 next）。 */
  commit: (next: unknown) => void;
  /** 文件被切换 / 外部替换 / 解析错误等：整体重置历史。 */
  reset: (snapshot: unknown) => void;
}

interface Options {
  /**
   * data 的当前值（来自上层 state），用于：
   * - commit 时把"旧 current"入栈
   * - 启动时作为初始快照
   */
  current: unknown;
  /**
   * 将 value 广播给外部（通常是 postUpdate 到插件）。
   * commit / undo / redo 都会调用。
   */
  onPush: (value: unknown) => void;
  /**
   * 识别"插件回响"的指纹。若 sync 回来的值等于最近一次 push 的值，
   * 应调用 acknowledgeSync 避免把回响当作外部变更误清历史。
   */
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function useUndoHistory(opts: Options): UndoApi & {
  /** 插件回响：由外部调用以"对齐"，不改动栈。 */
  acknowledgeSync: (value: unknown) => boolean;
} {
  const pastRef = useRef<unknown[]>([]);
  const futureRef = useRef<unknown[]>([]);
  /** 最近一次我们主动 push 的值；用于识别来自插件的回响 sync。 */
  const lastPushedRef = useRef<{ value: unknown; hasValue: boolean }>({
    value: undefined,
    hasValue: false,
  });
  const [, forceTick] = useState(0);
  const rerender = useCallback(() => forceTick((n) => n + 1), []);

  const { current, onPush } = opts;

  const commit = useCallback(
    (next: unknown) => {
      if (sameValue(next, current)) return;
      // 旧 current 入 past
      pastRef.current.push(current);
      if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
      futureRef.current = [];
      lastPushedRef.current = { value: next, hasValue: true };
      onPush(next);
      rerender();
    },
    [current, onPush, rerender],
  );

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) return;
    const prev = past.pop()!;
    futureRef.current.push(current);
    lastPushedRef.current = { value: prev, hasValue: true };
    onPush(prev);
    rerender();
  }, [current, onPush, rerender]);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return;
    const next = future.pop()!;
    pastRef.current.push(current);
    if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
    lastPushedRef.current = { value: next, hasValue: true };
    onPush(next);
    rerender();
  }, [current, onPush, rerender]);

  const reset = useCallback(
    (_snapshot: unknown) => {
      pastRef.current = [];
      futureRef.current = [];
      lastPushedRef.current = { value: undefined, hasValue: false };
      rerender();
    },
    [rerender],
  );

  const acknowledgeSync = useCallback((value: unknown) => {
    const last = lastPushedRef.current;
    if (last.hasValue && sameValue(last.value, value)) {
      // 这是我们自己 push 出去的回响：清掉指纹、保留栈
      lastPushedRef.current = { value: undefined, hasValue: false };
      return true;
    }
    return false;
  }, []);

  return {
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    commit,
    undo,
    redo,
    reset,
    acknowledgeSync,
  };
}

/**
 * 监听全局 Ctrl/Cmd+Z / Ctrl+Y / Ctrl+Shift+Z 快捷键，统一走 JSON 层 undo/redo。
 *
 * 为什么无条件拦截（即便焦点在 input/textarea 里）：
 * - 表格/表单采用 blur 提交模型，用户编辑后焦点常落在下一个 input；
 *   若那时放行原生 undo，触发的是下一个 input 自身的历史栈（通常为空），
 *   用户会觉得"按了 Ctrl+Z 没反应"。
 * - 我们希望一次快捷键始终对应一次"上一次已提交到 JSON 的变更"的撤销，
 *   行为与 VS Code 文本编辑器的单一 undo 栈保持一致。
 */
export function useUndoShortcuts(api: Pick<UndoApi, 'undo' | 'redo' | 'canUndo' | 'canRedo'>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      // redo: Ctrl/Cmd+Shift+Z 或 Ctrl+Y
      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        e.stopPropagation();
        // 若当前焦点在 input/textarea，先让它把本次 pending 的值 blur 提交出去，
        // 避免"正在输入但未提交的改动"被 redo 覆盖。
        blurActiveEditable();
        if (api.canRedo) api.redo();
        return;
      }
      // undo: Ctrl/Cmd+Z
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        blurActiveEditable();
        if (api.canUndo) api.undo();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [api.undo, api.redo, api.canUndo, api.canRedo]);
}

/**
 * 若当前焦点在可编辑元素（input/textarea/contenteditable），先让它失焦。
 * 多数视图采用 onBlur 提交，blur 会把"正在输入的值"写入历史栈，
 * 紧接着 undo() 才能撤销到"这次编辑之前的状态"。
 */
function blurActiveEditable() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return;
  const tag = el.tagName;
  const editable =
    tag === 'TEXTAREA' ||
    (tag === 'INPUT' &&
      !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(
        (el as HTMLInputElement).type,
      )) ||
    el.isContentEditable;
  if (editable && typeof el.blur === 'function') {
    try {
      el.blur();
    } catch {
      /* noop */
    }
  }
}
