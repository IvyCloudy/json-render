# Data Render

把 JSON / JSONL / YAML / CSV 文件以 **Tree / Table / Form / Chart / Card / Ant Design 动态表单** 6 种视图渲染的 VSCode 插件，支持搜索和**双向编辑**（Webview 编辑后自动写回源文件）。

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
- HTTP 提交：`__form.submit` 配置发送 HTTP 请求，支持 Bearer 鉴权、动态 Token 获取、multipart 文件上传
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
2. 点击编辑器右上角 Data Render 图标，或命令面板 `Cmd/Ctrl+Shift+P` → `Data Render: Preview Current File`
3. 在预览面板中编辑数据，改动会自动同步回源文件

## 视图自动决策

插件根据 JSON 数据结构自动选择最合适的视图，优先级如下：

| 优先级 | 规则 | 视图 |
|--------|------|------|
| P0 | 配置项 `jsonRender.defaultView` 非 `auto` | 用户指定 |
| P0 | JSONL / NDJSON 文件 | Table |
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
| `defaultValue` | `unknown` | ❌ | 只读默认值，仅在 formData 中无该字段时生效 |
| `tooltip` | `string` | ❌ | 标签旁问号图标提示文案 |
| `rules` | `Array<Record<string, unknown>>` | ❌ | Ant Design 校验规则 |
| `options` | `Array<{ label: string; value: unknown }>` | ❌ | 静态选项（Select / Radio / Checkbox / Cascader / Transfer） |
| `props` | `Record<string, unknown>` | ❌ | 直接传递给组件的额外属性 |
| `valuePropName` | `string` | ❌ | 值属性名，Switch 用 `"checked"`，Upload 用 `"fileList"` |
| `dataSource` | `FormItemDataSource` | ❌ | 远程数据源配置，支持 HTTP 动态获取选项/值（见下方） |

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

### 字段数据源（dataSource）

在 `formConfig` 中为字段配置 `dataSource`，可从 HTTP 接口动态获取数据，支持两种模式：

#### 模式一：options（下拉选项）

适用于 `Select`、`TreeSelect`、`Cascader`、`Radio.Group`、`Checkbox.Group`、`Transfer` 等选择类组件。HTTP 响应会被转换为下拉选项列表。

```jsonc
{
  "keyName": "userId",
  "component": "Select",
  "dataSource": {
    "http": {
      "url": "https://api.example.com/users",
      "method": "GET",
      "headers": { "Authorization": "Bearer xxx" }
    },
    "mode": "options",                    // 可省略，选择类组件默认就是 options
    "transform": {
      "path": "$.data.list",              // JSONPath 定位响应中的数组
      "labelField": "name",               // 数组元素的 label 字段
      "valueField": "id"                  // 数组元素的 value 字段
    },
    "fallback": [                         // 请求失败时的降级选项
      { "label": "加载失败，请刷新重试", "value": "", "disabled": true }
    ]
  }
}
```

**响应示例**：
```json
{
  "code": 0,
  "data": {
    "list": [
      { "id": 1, "name": "张三" },
      { "id": 2, "name": "李四" }
    ]
  }
}
```

#### 模式二：value（字段值填充）

适用于 `Input`、`InputNumber`、`DatePicker` 等非选择类组件。HTTP 响应会被直接填充到表单字段。

```jsonc
{
  "keyName": "userName",
  "component": "Input",
  "dataSource": {
    "http": {
      "url": "https://api.example.com/user/{{userId}}",
      "method": "GET"
    },
    "mode": "value",                      // 非选择类组件默认就是 value
    "transform": {
      "path": "$.data.name"               // JSONPath 定位响应中的具体值
    }
  }
}
```

**响应示例**：
```json
{
  "code": 0,
  "data": { "name": "张三", "age": 25 }
}
```
字段会自动填充 `"张三"`。

#### 级联依赖（watch）

一个字段的 dataSource 可以依赖其他字段的值，实现级联选择：

```jsonc
{
  "keyName": "cityId",
  "component": "Select",
  "dataSource": {
    "http": {
      "url": "https://api.example.com/cities",
      "query": { "provinceId": "{{provinceId}}" }  // 模板插值
    },
    "watch": ["provinceId"],              // 监听字段变化
    "condition": "{{provinceId}} != null", // 触发条件
    "clearOnWatchChange": true,           // 依赖变化时清空当前值
    "transform": {
      "path": "$.data",
      "labelField": "name",
      "valueField": "id"
    }
  }
}
```

#### 缓存配置

```jsonc
"cache": {
  "ttl": 60000                            // 缓存有效期（毫秒），默认 30000
}
```

#### dataSource 完整字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `http.url` | `string` | 请求地址，支持 `{{keyName}}` 模板插值 |
| `http.method` | `GET \| POST \| PUT \| DELETE` | HTTP 方法，默认 GET |
| `http.headers` | `Record<string, string>` | 请求头，支持模板插值 |
| `http.query` | `Record<string, unknown>` | URL 查询参数，支持模板插值 |
| `http.body` | `unknown` | 请求体（POST/PUT 时有效），支持模板插值 |
| `http.timeoutMs` | `number` | 超时时间（毫秒） |
| `mode` | `options \| value` | 数据模式，选择类组件默认 options，其他默认 value |
| `transform.path` | `string` | **JSONPath** 表达式，定位响应中的数据（必须以 `$` 开头） |
| `transform.labelField` | `string` | options 模式下，数组元素的 label 字段名 |
| `transform.valueField` | `string` | options 模式下，数组元素的 value 字段名 |
| `transform.disabledField` | `string` | options 模式下，数组元素的 disabled 字段名 |
| `fallback` | `Array<{label, value, disabled?}>` | 请求失败时的降级选项 |
| `watch` | `string[]` | 监听其他字段变化，触发重新请求 |
| `condition` | `string` | 触发条件表达式，支持模板插值（如 `{{fieldName}}`，字段有值时为真） |
| `clearOnWatchChange` | `boolean` | watch 字段变化时是否清空当前值 |
| `cache.ttl` | `number` | 缓存有效期（毫秒），默认 30000 |

### HTTP 提交配置（__form）

`__form` 放在 JSON 根节点，控制表单提交行为：

```jsonc
{
  "__form": {
    "auth": {
      "bearer": "{{token}}",               // 可选；静态 Bearer token
      "tokenRequest": {                     // 可选；提交前先请求动态 token
        "url": "https://auth.example.com/token",
        "method": "POST",
        "headers": { "Content-Type": "application/json" },
        "body": {
          "username": "{{username}}",
          "password": "{{password}}",
          "grant_type": "password"
        },
        "timeoutMs": 10000
      }
    },
    "submit": [
      {
        "label": "创建用户",
        "url": "https://httpbin.org/post",
        "method": "POST",
        "headers": {
          // "$tokenResponse" 特殊 key：将其 JSONPath 值定位的对象的所有字段合并到 headers
          "$tokenResponse": "$.*",          // $.* → 合并 token 响应全部字段；$.json.* → 合并 $.json 子对象
          "sign-token": "$.json",           // $.xxx → 从 token 响应中用 JSONPath 提取单个字段
          "X-Source": "json-render"         // 普通字符串（不会被覆盖）
        },
        "query": { "role": "{{role}}" },
        "body": {
          "$formConfig": true,              // 合并整个 formData 到 body
          "name": "{{name}}",
          "sign-token": "$.json"            // body 中同样支持 JSONPath 提取
        },
        "requiredPaths": ["name", "email"],
        "confirm": "确定提交？",
        "timeoutMs": 15000,
        "responsePath": "lastResponse",
        "variant": "primary"
      },
      {
        "type": "reset",
        "label": "重置",
        "variant": "secondary",
        "confirm": "确定重置所有字段？"
      }
    ]
  }
}
```

#### 鉴权方式

| 方式 | 配置 | 说明 |
|------|------|------|
| 静态 Bearer | `auth.bearer: "{{token}}"` | 从 formData 中取 token，自动注入 `Authorization: Bearer xxx` 头 |
| 动态 Token 请求 | `auth.tokenRequest: { ... }` | 提交前先发 HTTP 请求获取 token 响应，token 响应暂存为 `$tokenResponse` |

#### headers 中的特殊处理

| 语法 | 说明 |
|------|------|
| `"$tokenResponse": "$.*"` | 将 token 响应对象的所有字段合并到 headers（去除末尾 `.*` 后定位父对象） |
| `"$tokenResponse": "$.json.*"` | 将 `tokenResponse.json` 的所有字段合并到 headers |
| `"key": "$.field"` | 从 token 响应中用 JSONPath 提取单个字段值 |
| `"key": "Bearer $.token"` | 混合字符串：`$.token` 部分会被替换为 JSONPath 解析结果 |
| `{{keyName}}` | 从 formData 中取值的 mustache 模板 |

#### body 中的 JSONPath 解析

body 中也可以使用 `$.xxx` JSONPath 表达式引用 token 响应中的字段，例如：

```jsonc
"body": {
  "$formConfig": true,
  "auth_payload": "$.json"        // 从 token 响应中提取 json 字段
}
```

#### 其他配置

**模板插值** — `url`、`headers` 值、`query` 值、`body` 值中的 `{{keyName}}` 会从 `formData` 中取值，找不到则从根级取值。

**`$formConfig: true`** — 在 body 中使用 `"$formConfig": true` 表示合并整个表单数据。

**`$file: "./path"`** — 在 body 中支持文件上传占位符：

```jsonc
"body": {
  "avatar": { "$file": "./avatar.png", "filename": "avatar.png", "contentType": "image/png" }
}
```

**`bodyPath`** — 用 JSON 路径指定 body 来源，如 `"bodyPath": "nested.field"` 只发送该路径的值。

参见完整示例：`examples/16-form-antdesign-dynamic-bearer.jsonc`。

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
│       │   ├── useUndoHistory.ts     # JSON 层 Undo/Redo
│       │   └── useDataSource.ts      # HTTP 数据源（dataSource 支持）
│       └── views/
│           ├── TreeView.tsx       # 树形视图（JSONPath 过滤）
│           ├── TableView.tsx      # 表格视图（内联编辑、CSV 导入导出）
│           ├── FormView.tsx       # 递归表单（formConfig 路由）
│           ├── AntdFormView.tsx   # Ant Design 动态表单渲染
│           ├── formConfigTypes.ts # formConfig 类型定义 + formData 工具
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
│   ├── 05-deep-nested.json       # 深层嵌套 + JSONPath
│   ├── 07-huge-array.json        # 200+ 行性能测试
│   ├── 08-edge-cases.json        # 边界情况
│   ├── 09-logs.jsonl             # JSONL 日志
│   ├── 10-events.ndjson          # NDJSON 事件流
│   ├── 12-form-antdesign-template.jsonc   # Ant Design 表单基础示例
│   ├── 13-form-antdesign-template.jsonc   # 全 19 种组件类型示例
│   ├── 14-form-antdesign-related-fields.jsonc  # 级联 Select + dataSource 动态加载
│   ├── 16-form-antdesign-dynamic-bearer.jsonc  # 动态 Token 鉴权 + JSONPath headers
│   ├── sample-avatar.txt         # 上传测试用文件
│   └── data.csv                  # CSV 导入测试数据
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