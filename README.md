# JSON Render

把 JSON 文件以 **树形 / 表格 / 表单 / 图表 / 卡片** 5 种视图渲染的 VSCode 插件，支持搜索和**双向编辑**（Webview 编辑后自动写回源文件）。

## ✨ 功能

- 🌳 **Tree**：可折叠树视图（基于 [@textea/json-viewer](https://github.com/TexteaInc/json-viewer)）
- 📊 **Table**：对象数组自动生成表格；普通对象渲染 K/V 表
- 📝 **Form**：递归表单，自动识别 string/number/boolean
- 📈 **Chart**：自动识别数值型数据，渲染 Bar / Line 图（基于 recharts）
- 🗂 **Card**：对象数组渲染为卡片流
- 🔍 全局搜索，匹配节点高亮
- 🔄 双向同步：Webview 编辑 → 源文件自动更新；源文件变化 → Webview 刷新

## 🚀 使用

1. 打开任意 `.json` 或 `.jsonc` 文件
2. 点击编辑器右上角 JSON Render 图标，或者
3. 命令面板 `Cmd/Ctrl+Shift+P` → `JSON Render: Preview Current File`

## ⚙️ 配置

| 配置项 | 说明 | 默认 |
|---|---|---|
| `jsonRender.defaultView` | 默认视图（tree/table/form/chart/card） | `tree` |
| `jsonRender.autoSync` | 是否自动把 Webview 编辑写回源文件 | `true` |

## 🛠 开发

```bash
npm install
npm run watch         # 启动 esbuild watch
# 在 VSCode 中按 F5 启动扩展宿主
```

## 📦 打包

```bash
npm install -g @vscode/vsce
npm run build
vsce package
```
