import React from 'react';

interface State {
  error: Error | null;
  info: string | null;
}

/**
 * 兜底 ErrorBoundary：
 * - 捕获子组件运行时错误，显示可读信息和重试按钮；
 * - 避免单次渲染异常把整个 webview 渲染为空白且无法恢复；
 * - 当外部数据变化（resetKey 变化）时自动清除错误状态。
 */
export class ErrorBoundary extends React.Component<
  React.PropsWithChildren<{ resetKey?: unknown }>,
  State
> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 打印到 webview devtools 便于排查
    // eslint-disable-next-line no-console
    console.error('[Data Render] render error:', error, info);
    this.setState({ info: info.componentStack ?? null });
  }

  componentDidUpdate(prev: Readonly<React.PropsWithChildren<{ resetKey?: unknown }>>) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, info: null });
    }
  }

  private handleReset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="jr-error" style={{ padding: 12 }}>
        <strong>Data Render: 渲染异常</strong>
        {'\n'}
        {error.message}
        {info ? `\n\n组件栈:${info}` : ''}
        {'\n\n'}
        <button type="button" onClick={this.handleReset}>
          重试
        </button>
      </div>
    );
  }
}
