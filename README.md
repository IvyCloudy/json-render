# JSON Render

把 JSON 文件以 **树形 / 表格 / 表单 / 图表 / 卡片 / Ant Design 动态表单** 6 种视图渲染的 VSCode 插件，支持搜索和**双向编辑**（Webview 编辑后自动写回源文件）。

## ✨ 功能

- 🌳 **Tree**：可折叠树视图（基于 [@textea/json-viewer](https://github.com/TexteaInc/json-viewer)）
- 📊 **Table**：对象数组自动生成表格；普通对象渲染 K/V 表
- 📝 **Form**：递归表单，自动识别 string/number/boolean
- 🎨 **Ant Design Form**：基于 `formConfig` 配置的动态表单，支持多列布局、表单校验、日期/时间选择器等
- 📈 **Chart**：自动识别数值型数据，渲染 Bar / Line 图（基于 recharts）
-  **Card**：对象数组渲染为卡片流
- 🔍 全局搜索，匹配节点高亮
- 🔄 双向同步：Webview 编辑 → 源文件自动更新；源文件变化 → Webview 刷新
- 📤 **HTTP 提交**：表单支持配置 `__form.submit` 发送 HTTP 请求，支持 multipart 文件上传

## 🏗 项目架构

```
json-render/
├── src/
│   ├── extension.ts          # VSCode 扩展入口，注册命令和配置
│   ├── previewPanel.ts       # Webview 面板管理，处理消息通信（含 JSONC 注释解析）
│   ├── common/               # 通用工具模块
│   │   ├── csv.ts            # CSV 解析
│   │   ├── jsonl.ts          # JSONL/NDJSON 解析
│   │   ├── jsonPath.ts       # JSON 路径操作
│   │   └── viewDecider.ts    # 视图自动决策逻辑
│   └── webview/              # Webview 前端代码
│       ├── index.tsx         # React 应用入口（dayjs 插件注册）
│       ├── App.tsx           # 主应用组件，视图切换
│       ├── styles.css        # 全局样式
│       ├── hooks/            # 自定义 Hooks（如 useVSCodeBridge）
│       └── views/            # 视图组件
│           ├── TreeView.tsx      # 树形视图
│           ├── TableView.tsx     # 表格视图
│           ├── FormView.tsx      # 表单视图（含 formConfig 检测路由）
│           ├── AntdFormView.tsx  # Ant Design 动态表单渲染
│           ├── formConfigTypes.ts# formConfig 类型定义
│           ├── SchemaForm.tsx    # JSON Schema 驱动的表单
│           ├── ChartView.tsx     # 图表视图
│           ├── CardView.tsx      # 卡片视图
│           ├── CompositeView.tsx # 复合视图
│           ├── SubmitBar.tsx     # 表单提交栏（支持 $formConfig 占位符）
│           └── viewUtils.tsx     # 视图工具函数
├── examples/                 # 示例文件
── media/                    # 图标等资源
├── dist/                     # 构建输出
└── esbuild.js               # 构建配置
```

## 🛠 技术栈

| 类别 | 技术 |
|---|---|
| 扩展框架 | VSCode Extension API |
| 前端框架 | React 18 + TypeScript |
| 构建工具 | esbuild |
| UI 组件库 | Ant Design v5（CSS-in-JS） |
| 日期处理 | dayjs + customParseFormat 插件 |
| 树形视图 | @textea/json-viewer |
| 图表库 | recharts |
| 测试框架 | Vitest |
| 消息通信 | VSCode Webview API (postMessage) |

## 🎨 Ant Design 动态表单设计

### formConfig 配置结构

在 JSON 根节点添加 `formConfig` 数组即可启用 Ant Design 表单渲染：

```jsonc
{
  "formConfig": [
    {
      "label": "用户名称",
      "keyName": "name",
      "keyValue": "Alice",
      "component": "Input",
      "col": { "span": 12 },
      "tooltip": "提示文本",
      "rules": [{ "required": true, "message": "必填项" }],
      "options": [{ "label": "选项", "value": "val" }],
      "props": { "placeholder": "请输入" }
    }
  ],
  "__form": {
    "submit": [{ "url": "https://api.example.com", "method": "POST" }]
  }
}
```

### 支持的组件类型

| component 值 | 映射组件 | 说明 |
|---|---|---|
| `Input` | `<Input />` | 文本输入 |
| `Input.TextArea` | `<Input.TextArea />` | 多行文本 |
| `InputNumber` | `<InputNumber />` | 数字输入 |
| `Select` | `<Select />` | 下拉选择 |
| `DatePicker` | `<DatePicker />` | 日期选择（自动转换 YYYY-MM-DD） |
| `TimePicker` | `<TimePicker />` | 时间选择（自动转换 HH:mm:ss） |
| `Switch` | `<Switch />` | 开关（valuePropName="checked"） |
| `Radio.Group` | `<Radio.Group />` | 单选组 |
| `Checkbox` | `<Checkbox />` | 复选框 |
| `Checkbox.Group` | `<Checkbox.Group />` | 复选组 |
| `Cascader` | `<Cascader />` | 级联选择 |
| `TreeSelect` | `<TreeSelect />` | 树选择 |
| `Upload` | `<Upload />` | 文件上传 |

### 核心设计

1. **路由检测**：`FormView.tsx` 检测数据中是否存在 `formConfig` 数组，存在则渲染 `AntdFormView`
2. **值同步**：通过 `Form.onValuesChange` 实时同步表单值到 JSON 数据，日期/时间自动转换为字符串格式
3. **布局**：使用 `Row`/`Col` 实现多列布局，`col.span` 控制列宽（默认 24）
4. **校验**：`rules` 直接映射到 Ant Design `Form.Item` 规则，`requiredPaths` 作为提交前二次校验
5. **提交**：`SubmitBar` 支持 `$formConfig: true` 占位符，自动提取表单值填充请求 body
6. **重置**：`type: "reset"` 按钮调用 `form.resetFields()` 恢复初始值

##  使用

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
json-render/
├── src/
│   ├── extension.ts          # VSCode 扩展入口，注册命令和配置
│   ├── previewPanel.ts       # Webview 面板管理，处理消息通信
│   ├── common/               # 通用工具模块
│   │   ├── csv.ts            # CSV 解析
│   │   ├── jsonl.ts          # JSONL/NDJSON 解析
│   │   ├── jsonPath.ts       # JSON 路径操作
│   │   └── viewDecider.ts    # 视图自动决策逻辑
│   └── webview/              # Webview 前端代码
│       ├── index.tsx         # React 应用入口
│       ├── App.tsx           # 主应用组件，视图切换
│       ├── styles.css        # 全局样式
│       ├── hooks/            # 自定义 Hooks（如 useVSCodeBridge）
│       └── views/            # 视图组件
│           ├── TreeView.tsx      # 树形视图
│           ├── TableView.tsx     # 表格视图
│           ├── FormView.tsx      # 表单视图
│           ├── SchemaForm.tsx    # JSON Schema 驱动的表单
│           ├── ChartView.tsx     # 图表视图
│           ├── CardView.tsx      # 卡片视图
│           ├── CompositeView.tsx # 复合视图
│           ├── SubmitBar.tsx     # 表单提交栏
│           └── viewUtils.tsx     # 视图工具函数
── examples/                 # 示例文件
├── media/                    # 图标等资源
├── dist/                     # 构建输出
└── esbuild.js               # 构建配置
```

## 🛠 技术栈

| 类别 | 技术 |
|---|---|
| 扩展框架 | VSCode Extension API |
| 前端框架 | React 18 + TypeScript |
| 构建工具 | esbuild |
| 树形视图 | @textea/json-viewer |
| 图表库 | recharts |
| 测试框架 | Vitest |
| 消息通信 | VSCode Webview API (postMessage) |



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
