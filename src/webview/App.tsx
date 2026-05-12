import React, { useEffect, useMemo, useState } from 'react';
import { useVSCodeBridge } from './hooks/useVSCodeBridge';
import { useUndoHistory, useUndoShortcuts } from './hooks/useUndoHistory';
import { TreeView } from './views/TreeView';
import { TableView } from './views/TableView';
import { FormView } from './views/FormView';
import { ChartView } from './views/ChartView';
import { CardView } from './views/CardView';
import { CompositeView } from './views/CompositeView';
import { ErrorBoundary } from './ErrorBoundary';
import { decideView, ViewKind } from '../common/viewDecider';

const VIEW_ICONS: Record<ViewKind, string> = {
  tree: '🌳',
  table: '📊',
  form: '📝',
  chart: '📈',
  card: '🗡',
  composite: '🧩',
};

export const App: React.FC = () => {
  const { state, postUpdate, postError } = useVSCodeBridge();
  const [search, setSearch] = useState('');
  /**
   * 用户手动选择的副视图，不持久化。
   * - null     → 走自动决策的主视图
   * - ViewKind → 覆盖为指定视图
   * 文件切换时自动重置。
   */
  const [override, setOverride] = useState<ViewKind | null>(null);
  useEffect(() => {
    setOverride(null);
  }, [state.fileName]);

  /**
   * liveData：webview 内的"权威真相"。
   * - 初始 / 文件切换 / 外部修改 → 从 state.data 同步
   * - 用户编辑 → 立即本地更新，同时 postUpdate 写回文档
   * - 插件的写回会 suppress 一次 sync 回响，因此 liveData 不能依赖 state.data 回传
   *   （否则快速连续编辑会丢失中间状态）
   */
  const [liveData, setLiveData] = useState<unknown>(state.data);

  // —— Undo/Redo 历史栈（以 liveData 为历史单位）——
  const history = useUndoHistory({
    current: liveData,
    onPush: (value) => {
      setLiveData(value);
      postUpdate(value);
    },
  });
  useUndoShortcuts(history);

  // bridge 每次推送 data 时：
  // - 若是我们自己刚刚 push 的值回响 → 对齐 liveData 但保留历史
  // - 否则（init / 文件切换 / 外部修改）→ 覆盖 liveData 并清空历史
  useEffect(() => {
    const isEcho = history.acknowledgeSync(state.data);
    if (isEcho) return;
    setLiveData(state.data);
    history.reset(state.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data]);

  const handleChange = (next: unknown) => {
    if (!state.autoSync) {
      // autoSync 关闭时不写回文件，但本地仍需更新以支持继续编辑
      setLiveData(next);
      return;
    }
    history.commit(next);
  };

  // 自动决策视图：数据/文件类型/Schema/配置项变化时重新计算
  const decision = useMemo(() => {
    if (state.parseError)
      return { view: 'tree' as ViewKind, reason: 'Parse error', alternatives: [] };
    const cfgOverride =
      state.defaultView && state.defaultView !== 'auto' ? (state.defaultView as ViewKind) : '';
    return decideView(liveData, {
      fileKind: state.fileKind === 'jsonl' ? 'jsonl' : 'json',
      override: cfgOverride,
    });
  }, [liveData, state.parseError, state.fileKind, state.defaultView]);

  const activeView: ViewKind = override ?? decision.view;

  const content = useMemo<React.ReactNode>(() => {
    if (state.parseError) {
      return (
        <div className="jr-error">
          <strong>{state.fileKind === 'jsonl' ? 'JSONL' : 'JSON'} parse error:</strong>
          {'\n'}
          {state.parseError}
        </div>
      );
    }
    if (liveData === null || liveData === undefined) {
      return <div className="jr-empty">No content.</div>;
    }
    const common = { data: liveData, search, onChange: handleChange, onError: postError };
    switch (activeView) {
      case 'tree':  return <TreeView {...common} />;
      case 'table': return <TableView {...common} />;
      case 'form':  return <FormView {...common} />;
      case 'chart': return <ChartView {...common} />;
      case 'card':  return <CardView {...common} />;
      case 'composite': return <CompositeView {...common} />;
      default:      return <TreeView {...common} />;
    }
  }, [liveData, state.parseError, state.fileKind, activeView, search, state.autoSync]);

  return (
    <div className="jr-app">
      <div className="jr-toolbar">
        {state.fileKind === 'jsonl' && <span className="jr-tag">JSONL</span>}
        <span
          className={`jr-tag jr-tag-auto${override ? ' jr-tag-auto-dim' : ''}`}
          title={
            override
              ? `Auto would be ${decision.view.toUpperCase()} (${decision.reason}). Click to restore.`
              : decision.reason
          }
          onClick={() => override && setOverride(null)}
          style={override ? { cursor: 'pointer' } : undefined}
        >
          {override ? `Auto: ${decision.view.toUpperCase()} ↻` : `Auto: ${decision.view.toUpperCase()}`}
        </span>
        {decision.alternatives.map((alt) => {
          const active = override === alt.view;
          return (
            <button
              key={alt.view}
              type="button"
              className={`jr-alt${active ? ' jr-alt-active' : ''}`}
              title={alt.reason}
              onClick={() => setOverride(active ? null : alt.view)}
            >
              {VIEW_ICONS[alt.view]} {alt.view[0].toUpperCase() + alt.view.slice(1)}
            </button>
          );
        })}
        <input
          className="jr-search"
          placeholder="🔍 Search key or value..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="jr-content">
        <ErrorBoundary resetKey={`${state.fileName}::${activeView}`}>{content}</ErrorBoundary>
      </div>
    </div>
  );
};
