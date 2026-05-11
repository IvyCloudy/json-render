# JSON Render

把 JSON / JSONL 文件以 **Tree / Table / Form / Chart / Card / Ant Design 动态表单** 6 种视图渲染的 VSCode 插件，支持搜索和**双向编辑**（Webview 编辑后自动写回源文件）。

## 功能

- **Tree**：可折叠树视图（基于 [@textea/json-viewer](https://github.com/TexteaInc/json-viewer)），支持 JSONPath 过滤
- **Table**：对象数组自动生成表格；普通对象渲染 K/V 表；支持 CSV 导入/导出
- **Form**：递归表单，自动识别 string / number / boolean / null / array 类型
- **Ant Design Form**：基于 `formConfig` 配置的动态表单，19 种组件，多列布局、校验、HTTP 提交
- **Chart**：自动识别数值型数据，渲染 Bar / Line 图（基于 recharts）
- **Card**：对象数组渲染为卡片流
- **Composite**：混合型根对象自动拆分为多个区块
- 自动视图决策：根据 JSON 结构智能选择最合适的视图
- 全局搜索，匹配节点高亮
- 双向同步：Webview 编辑 → 源文件自动更新；源文件变化 → Webview 刷新
- HTTP 提交：`__form.submit` 配置发送 HTTP 请求，支持 Bearer 鉴权、multipart 文件上传
- Undo / Redo：JSON 层级历史栈，支持 Ctrl/Cmd+Z / Ctrl/Cmd+Y

## 安装

1. 打开 VSCode
2. 按 `Cmd/Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. 选择打包好的 `.vsix` 文件

或者从源码构建：

```bash
git clone https://github.com/your-repo/json-render.git
cd json-render
npm install
npm run build
# 按 F5 在 VSCode 扩展宿主中调试
```

## 使用

1. 打开任意 `.json` / `.jsonc` / `.jsonl` / `.ndjson` 文件
2. 点击编辑器右上角 JSON Render 图标，或命令面板 `Cmd/Ctrl+Shift+P` → `JSON Render: Preview Current File`
3. 在预览面板中编辑数据，改动会自动同步回源文件

## 视图自动决策

插件根据 JSON 数据结构自动选择最合适的视图，优先级如下：

| 优先级 | 规则 | 视图 |
|--------|------|------|
| P0 | 配置项 `jsonRender.defaultView` 非 `auto` | 用户指定 |
| P0 | JSONL / NDJSON 文件 | Table |
| P0 | 外部 JSON Schema 或内嵌 `$schema` | Form |
| P0 | 数据内嵌 `__view` / `$view` / `_render` | 指定视图 |
| P0 | 内嵌 `__form` | Form |
| P0 | 内嵌 `formConfig` 数组 | Form |
| P0 | 内嵌 `formData` 对象 | Form |
| P1 | 同质对象数组（≥70% 字段重叠） | Table |
| P1 | 异质对象数组 | Card |
| P1 | 基本类型数组 | Table |
| P1 | 扁平对象（值均为基本类型） | Form |
| P2 | 含 `children` / `nodes` / `items` / `leaf` | Tree |
| P2 | 含 `series` / `dataset` | Chart |
| P2 | 混合根对象（对象数组 + 嵌套 + 基本值） | Composite |
| P3 | 兜底 | Tree |

视图切换栏还会显示可用的备选视图（如 Table 下可选 Chart / Card），一键切换。

## Ant Design 动态表单

在 JSON 文件中声明 `formConfig` 数组和 `formData` 对象即可启用 Ant Design 动态表单渲染。

### 数据三层模型

```
┌──────────────────────────────────────────────────┐
│  JSON 文件                                        │
│                                                   │
│  formData    → 业务数据（编辑目标，表单初始值）      │
│  formConfig  → UI 渲染描述（字段如何展示）          │
│  __form      → 协议配置（提交去哪、怎么鉴权）       │
└──────────────────────────────────────────────────┘
```

**`formData`** 集中存放所有表单字段的值，`formConfig` 只描述 UI 渲染逻辑，`__form` 描述提交行为。三者职责清晰分离，消除了旧方案中 `keyValue` 与根级字段的双值冗余问题。

> 向后兼容：如果 JSON 中没有 `formData` 字段，插件会从根级字段中剥离 `__form` / `formConfig` 后作为初始值，`keyValue` 也作为 fallback。

### 完整示例

```jsonc
{
  "formData": {
    "name": "Alice",
    "role": "admin",
    "age": 18,
    "active": true
  },
  "formConfig": [
    {
      "label": "姓名",
      "keyName": "name",
      "component": "Input",
      "col": { "span": 12 },
      "rules": [{ "required": true, "message": "姓名必填" }],
      "props": { "placeholder": "请输入姓名" }
    },
    {
      "label": "角色",
      "keyName": "role",
      "component": "Select",
      "col": { "span": 12 },
      "options": [
        { "label": "管理员", "value": "admin" },
        { "label": "开发者", "value": "developer" }
      ]
    },
    {
      "label": "年龄",
      "keyName": "age",
      "component": "InputNumber",
      "col": { "span": 8 },
      "props": { "min": 1, "max": 120 }
    },
    {
      "label": "已激活",
      "keyName": "active",
      "component": "Switch",
      "col": { "span": 12 },
      "valuePropName": "checked"
    }
  ],
  "__form": {
    "auth": { "bearer": "{{token}}" },
    "submit": [
      {
        "label": "保存",
        "url": "https://httpbin.org/anything/{{name}}",
        "method": "POST",
        "variant": "primary"
      }
    ]
  }
}
```

### FormConfigItem 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `label` | `string` | ✅ | 表单项标签 |
| `keyName` | `string` | ✅ | 对应 `formData` 中的键名 |
| `component` | `AntdComponentName` | ✅ | 组件类型，见下表 |
| `col` | `{ span: number; offset?: number }` | ❌ | 栅格布局，`span` 默认 24 |
| `tooltip` | `string` | ❌ | 标签旁问号图标提示文案 |
| `rules` | `Array<Record<string, unknown>>` | ❌ | Ant Design 校验规则 |
| `options` | `Array<{ label: string; value: unknown }>` | ❌ | Select / Radio.Group / Checkbox.Group / Cascader / Transfer 选项 |
| `props` | `Record<string, unknown>` | ❌ | 直接传递给组件的额外属性 |
| `valuePropName` | `string` | ❌ | 值属性名，Switch 用 `"checked"`，Upload 用 `"fileList"` |

### 支持的组件类型

| component | Ant Design 组件 | 值类型 | 说明 |
|-----------|-----------------|--------|------|
| `Input` | `<Input />` | `string` | 文本输入 |
| `Input.TextArea` | `<Input.TextArea />` | `string` | 多行文本 |
| `InputNumber` | `<InputNumber />` | `number` | 数字输入 |
| `Select` | `<Select />` | `string \| string[]` | 下拉选择 |
| `DatePicker` | `<DatePicker />` | `string` (YYYY-MM-DD) | 日期选择 |
| `TimePicker` | `<TimePicker />` | `string` (HH:mm:ss) | 时间选择 |
| `Switch` | `<Switch />` | `boolean` | 开关 |
| `Radio.Group` | `<Radio.Group />` | `string` | 单选组 |
| `Checkbox` | `<Checkbox />` | `boolean` | 复选框 |
| `Checkbox.Group` | `<Checkbox.Group />` | `string[]` | 复选组 |
| `Cascader` | `<Cascader />` | `string[]` | 级联选择 |
| `TreeSelect` | `<TreeSelect />` | `string` | 树选择（treeData 通过 props 传入） |
| `Upload` | `<Upload />` | `File[]` | 文件上传 |
| `Slider` | `<Slider />` | `number \| number[]` | 滑动条 |
| `ColorPicker` | `<ColorPicker />` | `string` (hex) | 颜色选择器 |
| `Rate` | `<Rate />` | `number` | 评分 |
| `Mentions` | `<Mentions />` | `string` | @提及输入 |
| `Transfer` | `<Transfer />` | `string[]` | 穿梭框（targetKeys） |
| `Tree` | `<Tree />` | `string[]` | 树（checkedKeys），需设 `valuePropName: "checkedKeys"` |

### 特殊组件说明

**ColorPicker** — 值存为 hex 字符串（如 `"#1677ff"`），自动与 Ant Design `Color` 对象互转。

**Transfer** — `options` 映射为 `dataSource`（`{ key, title }` 格式），值存储 targetKeys（右侧选中的 key 数组）。

**Tree** — 通过 `props.treeData` 传入树结构数据，默认 `valuePropName="checkedKeys"`，值为选中的 key 数组。

**Upload** — `valuePropName="fileList"`，值类型为文件列表数组。

**Cascader / TreeSelect** — 通过 `options` 或 `props.treeData` 传入嵌套数据。

### HTTP 提交配置（__form）

`__form` 放在 JSON 根节点，控制表单提交行为：

```jsonc
{
  "__form": {
    "auth": { "bearer": "{{token}}" },       // 可选，自动注入 Authorization 头
    "submit": [
      {
        "label": "创建用户",                   // 按钮文案
        "url": "https://httpbin.org/post",     // 请求地址
        "method": "POST",                      // HTTP 方法
        "headers": { "X-Source": "json-render" },  // 额外请求头
        "query": { "role": "{{role}}" },       // URL 查询参数（支持模板插值）
        "body": { "name": "{{name}}", "age": "{{age}}" },  // 请求体
        "requiredPaths": ["name", "email"],    // 提交前校验必填
        "confirm": "确定提交？",               // 可选，提交前确认弹窗
        "timeoutMs": 15000,                    // 可选，超时时间
        "responsePath": "lastResponse",        // 可选，响应数据回写路径
        "variant": "primary"                   // 按钮样式：primary / secondary / danger
      },
      {
        "type": "reset",                       // 客户端重置按钮，不发请求
        "label": "重置",
        "variant": "secondary",
        "confirm": "确定重置所有字段？"
      }
    ]
  }
}
```

**模板插值** — `url`、`headers` 值、`query` 值、`body` 值中的 `{{keyName}}` 会从 `formData` 中取值，找不到则从根级取值。

**`$formConfig: true`** — 在 body 中使用 `"$formConfig": true` 表示合并整个表单数据。

**`$file: "./path"`** — 在 body 中支持文件上传占位符：

```jsonc
"body": {
  "avatar": { "$file": "./avatar.png", "filename": "avatar.png", "contentType": "image/png" }
}
```

**`bodyPath`** — 用 JSON 路径指定 body 来源，如 `"bodyPath": "nested.field"` 只发送该路径的值。

### 模板插值作用域

```
{{name}}  →  优先从 formData.name 取值
              然后从根级 data.name 取值
              找不到返回空字符串
```

## 项目架构

```
json-render/
├── src/
│   ├── extension.ts              # VSCode 扩展入口，注册命令和配置
│   ├── previewPanel.ts           # Webview 面板管理，消息通信，JSONC 解析
│   ├── common/
│   │   ├── csv.ts                # CSV 解析 / 导出
│   │   ├── jsonl.ts              # JSONL / NDJSON 解析
│   │   ├── jsonPath.ts           # JSONPath 查询
│   │   └── viewDecider.ts        # 视图自动决策逻辑（含 homogeneity 计算）
│   └── webview/
│       ├── index.tsx             # React 应用入口
│       ├── App.tsx               # 主应用组件，视图切换
│       ├── styles.css            # 全局样式（VSCode 主题变量）
│       ├── hooks/
│       │   ├── useVSCodeBridge.ts    # VSCode ↔ Webview 通信
│       │   └── useUndoHistory.ts     # JSON 层 Undo/Redo
│       └── views/
│           ├── TreeView.tsx       # 树形视图（JSONPath 过滤）
│           ├── TableView.tsx      # 表格视图（内联编辑、CSV 导入导出）
│           ├── FormView.tsx       # 递归表单（formConfig 路由）
│           ├── AntdFormView.tsx   # Ant Design 动态表单渲染
│           ├── formConfigTypes.ts # formConfig 类型定义 + formData 工具
│           ├── SchemaForm.tsx     # JSON Schema 驱动的表单
│           ├── ChartView.tsx      # 图表视图（recharts）
│           ├── CardView.tsx       # 卡片视图
│           ├── CompositeView.tsx  # 复合视图（混合对象自动拆分）
│           ├── SubmitBar.tsx      # 表单提交栏（HTTP 请求、文件上传）
│           └── viewUtils.tsx      # 视图工具函数
├── examples/                     # 示例文件
│   ├── 01-simple.json            # 基础对象
│   ├── 02-users-table.json       # 对象数组 → 表格
│   ├── 03-sales-chart.json       # 数值数据 → 图表
│   ├── 04-products-card.json     # 卡片展示
│   ├── 05-deep-nested.json      # 深层嵌套 + JSONPath
│   ├── 06-config.json + .schema  # Schema 驱动表单
│   ├── 07-huge-array.json        # 200+ 行性能测试
│   ├── 08-edge-cases.json        # 边界情况
│   ├── 09-form-submit.json       # __form 基础提交
│   ├── 09-logs.jsonl             # JSONL 日志
│   ├── 10-events.ndjson          # NDJSON 事件流
│   ├── 11-form-submit-advanced   # 高级提交（鉴权、超时、文件上传、mock）
│   ├── 12-form-antdesign-template.jsonc  # Ant Design 动态表单完整示例
│   └── 13-form-antdesign-template.jsonc  # 全组件类型示例（19 种组件）
├── media/                        # 图标等资源
├── dist/                          # 构建输出
└── esbuild.js                     # 构建配置
```

## 技术栈

| 类别 | 技术 |
|------|------|
| 扩展框架 | VSCode Extension API |
| 前端框架 | React 18 + TypeScript |
| 构建工具 | esbuild |
| UI 组件库 | Ant Design v5（CSS-in-JS） |
| 日期处理 | dayjs + customParseFormat |
| 树形视图 | @textea/json-viewer |
| 图表库 | recharts |
| 测试框架 | Vitest |
| 消息通信 | VSCode Webview API (postMessage) |

## 配置

| 配置项 | 说明 | 默认 |
|--------|------|------|
| `jsonRender.defaultView` | 默认视图（`auto` / `tree` / `table` / `form` / `chart` / `card`） | `auto` |
| `jsonRender.autoSync` | 是否自动把 Webview 编辑写回源文件 | `true` |
| `jsonRender.autoSave` | 同步后是否自动保存文件到磁盘 | `true` |
| `jsonRender.schemaFile` | JSON Schema 文件路径（相对 JSON 文件），为空时自动查找同名 `.schema.json` | `""` |
| `jsonRender.enableMockServer` | 启动本地 Mock HTTP 服务器用于 `__form.submit` 测试 | `false` |

## 开发

```bash
npm install
npm run watch         # 启动 esbuild watch
# 在 VSCode 中按 F5 启动扩展宿主

npm test               # 运行测试
npm run compile        # TypeScript 类型检查
```

## 打包

```bash
npm install -g @vscode/vsce
npm run build
vsce package
```