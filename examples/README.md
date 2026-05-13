
# JSON Render 测试样例

这些文件用于手动验证插件各视图与扩展点是否工作正常。

| 文件 | 推荐视图 | 验证点 |
| --- | --- | --- |
| `01-simple.json` | Tree / Form | 最基础对象，主键/嵌套/数组混合 |
| `02-users-table.json` | Table | 对象数组 → 表格，CSV 导入/导出 |
| `03-sales-chart.json` | Chart | 月份-销量数组，折线/柱状图 |
| `04-products-card.json` | Card | 带 `title/description/image` 的卡片展示 |
| `05-deep-nested.json` | Tree + JSONPath | 深层嵌套，测 `$..author`、`[?(@.price<10)]` 等 |
| `07-huge-array.json` | Table | 200+ 行，测性能与滚动 |
| `08-edge-cases.json` | Tree | null、空串、布尔、科学计数、转义、unicode、长字符串 |
| `09-logs.jsonl` | Table (JSONL) | 按行 NDJSON，每行一条日志 |
| `10-events.ndjson` | Table (JSONL) | `.ndjson` 扩展名测试 |
| `12-form-antdesign-template.jsonc` | Form (Ant Design) | Ant Design 表单：formConfig + formData + __form.submit |
| `13-form-antdesign-template.jsonc` | Form (Ant Design) | 全部 19 种 Ant Design 组件演示 |
| `14-form-antdesign-related-fields.jsonc` | Form (Ant Design) | 级联 Select + dataSource 动态加载 |
| `16-form-antdesign-dynamic-bearer.jsonc` | Form (Ant Design) | 动态 Token 鉴权 + JSONPath headers/body 解析 |

## 快速试用

1. 先 `npm run build` 构建；
2. VS Code 打开本仓库，按 `F5` 启动扩展宿主；
3. 在宿主窗口中打开本目录任意文件 → 编辑器右上角点 **JSON Render** 图标，或命令面板 `JSON Render: Preview Current File`。

## JSONPath 建议试用表达式（打开 `05-deep-nested.json`）

```
$.store.book[*].title                          所有书名
$.store.book[?(@.price<10)]                    价格低于 10 的书
$..author                                      递归找所有作者
$.store.book[?(@.category=='fiction')].title   小说类书名
$..book[?(@.isbn)]                             带 isbn 的书
$.store.bicycle.color                          精确成员访问
```
