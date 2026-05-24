# DeepSeek to Codex Proxy

这是一个 OpenAI 兼容中转服务，用于把 Codex 或其他 AI 客户端的请求转发到 DeepSeek API。

## 为什么需要中转

- DeepSeek API Key 不能写在前端页面或公开仓库中。
- Codex 这类工具通常通过 `base_url`、`api_key`、`model` 访问模型。
- 中转服务可以隐藏真实 DeepSeek Key，并把 `/v1/chat/completions` 转成 DeepSeek 的 `/chat/completions`。

## 本地运行

复制环境变量模板：

```bash
copy .env.example .env
```

编辑 `.env`：

```env
PORT=8787
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
PROXY_API_KEY=change-this-if-public
FORCE_MODEL=false
```

启动服务：

```bash
npm start
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

## 调用测试

如果设置了 `PROXY_API_KEY`：

```bash
curl http://127.0.0.1:8787/v1/chat/completions ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer change-this-if-public" ^
  -d "{\"model\":\"deepseek-v4-flash\",\"messages\":[{\"role\":\"user\",\"content\":\"你好，介绍一下你自己\"}]}"
```

如果没有设置 `PROXY_API_KEY`，可以去掉 `Authorization` 请求头。

## Codex 接入示例

如果你的 Codex 配置支持 OpenAI-compatible Chat Completions，可以新增一个 provider：

```toml
model_provider = "DeepSeekProxy"
model = "deepseek-v4-flash"

[model_providers.DeepSeekProxy]
name = "DeepSeek Proxy"
base_url = "http://127.0.0.1:8787/v1"
wire_api = "chat"
requires_openai_auth = true
```

然后把 Codex 客户端使用的 API Key 设置为 `PROXY_API_KEY`。如果你没有设置 `PROXY_API_KEY`，可以填任意非空字符串，具体取决于客户端是否强制要求 API Key。

公网服务器部署时，建议：

- 使用 HTTPS 域名，例如 `https://api.your-domain.com/v1`
- 必须设置 `PROXY_API_KEY`
- 不要把 `.env` 提交到 GitHub
- 不要在前端 HTML 中暴露 `DEEPSEEK_API_KEY`

## 支持的接口

- `GET /health`
- `GET /v1/models`
- `GET /models`
- `POST /v1/chat/completions`
- `POST /chat/completions`

DeepSeek 官方当前推荐的 OpenAI 格式 `base_url` 是 `https://api.deepseek.com`，新模型名为 `deepseek-v4-flash` 和 `deepseek-v4-pro`。
