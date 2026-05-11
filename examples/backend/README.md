# Verification Backend

零依赖的本地后端，用于验证 [`examples/11-form-submit-advanced.json`](../11-form-submit-advanced.json) 里 `__form.submit` 的所有按钮。

## 启动

```bash
# 默认端口 39870（与示例 JSON 保持一致）
node examples/backend/server.js

# 自定义端口
PORT=39880 node examples/backend/server.js
```

启动后终端会打印所有可用端点。按 `Ctrl+C` 退出。

## 端点

| Method | Path                 | 作用                              |
|--------|----------------------|-----------------------------------|
| GET    | `/health`            | 健康检查                          |
| \*     | `/echo`              | 回显方法 / 路径 / 查询 / 头 / body |
| POST   | `/slow?ms=6000`      | 延迟 `ms` 毫秒再回显，用于测试超时 |
| POST   | `/fail?code=500`     | 按指定状态码返回错误              |
| POST   | `/upload`            | 解析 `multipart/form-data`        |
| GET    | `/view/:id`          | `openUrl` 跳转到的 HTML 验证页    |

所有 JSON 响应都带 `redirect` 字段指向 `/view/<随机 id>`，供 `__form.submit.openUrl` 使用。

## 验证步骤

1. 启动后端：`node examples/backend/server.js`
2. 在 VS Code 里 `F5` 启动 Extension Host
3. 在新窗口打开 `examples/11-form-submit-advanced.json`，切到 Form 视图
4. 依次点击底部按钮，对照终端日志和 UI 上的状态即可。
