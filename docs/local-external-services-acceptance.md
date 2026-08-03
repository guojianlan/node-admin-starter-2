# 本地外部服务验收与配置

本文用于在不使用真实云凭据的情况下，验证 Admin Base 的 S3、SMTP、OAuth、SMS 和
AI Provider 集成。验收环境只编排外部依赖，不替代源码启动方式，也不会执行
`db:reset`。

## 服务清单

| 服务           | 容器                   | 本机地址                                         | 用途                                 |
| -------------- | ---------------------- | ------------------------------------------------ | ------------------------------------ |
| MinIO          | `minio` / `minio-init` | API `127.0.0.1:19000`；Console `127.0.0.1:19001` | S3-compatible 存储                   |
| Mailpit        | `mailpit`              | SMTP `127.0.0.1:11025`；Web `127.0.0.1:18025`    | 邮件发送和收件箱检查                 |
| Keycloak       | `keycloak`             | `127.0.0.1:18080`                                | OAuth Authorization Code 流程        |
| External Mock  | `external-mock`        | `127.0.0.1:18081`                                | SMS Webhook 和 OpenAI-compatible API |
| Ollama（可选） | `ollama`               | `127.0.0.1:11435`                                | 本地真实模型推理                     |

所有账号和密钥都是固定的本地验收值，只能用于本机。不得复制到 staging 或 production。

## 启动与关闭

先启动 Admin Base：

```bash
pnpm dev
```

默认验收地址为 `http://127.0.0.1:3000`，默认管理员密码为开发 seed 的 `123456`。如果本机使用
其他地址或密码，在执行脚本前设置：

```bash
export ACCEPTANCE_APP_BASE_URL=http://127.0.0.1:3000
export ADMIN_BASE_ADMIN_PASSWORD=<本地管理员密码>
```

脚本不会读取或修改生产凭据，也不会执行 migration、seed 或 `db:reset`。

启动本地依赖：

```bash
pnpm acceptance:deps:up
docker compose -f compose.acceptance.yml ps
```

按固定顺序逐项执行：

```bash
pnpm acceptance:external s3
pnpm acceptance:external smtp
pnpm acceptance:external oauth
pnpm acceptance:external sms
pnpm acceptance:external ai
```

也可以一次执行全部项目：

```bash
pnpm acceptance:external
```

验收脚本会创建以 `acceptance-` 开头的临时资源，完成连接和业务调用后自动删除，
并恢复原来的默认存储。它不会删除现有业务文件或重置数据库。

验收完成后关闭容器并删除验收卷：

```bash
pnpm acceptance:deps:down
docker compose -f compose.acceptance.yml ps
```

`acceptance:deps:down` 包含 `-v`，只删除 Compose 项目 `admin-base-acceptance` 的 MinIO、
Mailpit 和可选 Ollama 卷，不影响 PostgreSQL 或 Admin Base 上传目录。

关闭整个 Docker Desktop/OrbStack 前应先运行 `docker ps`。如果还有其他项目容器，不要关闭
Docker 引擎；本验收只要求 `docker compose -f compose.acceptance.yml ps -a` 返回空列表。

## 页面手工配置

### MinIO S3

页面：`/system/storage`

| 字段       | 本地值                                         |
| ---------- | ---------------------------------------------- |
| 名称       | `MinIO 本地验收`                               |
| 编码       | `acceptance-minio`                             |
| 类型       | `s3`                                           |
| Endpoint   | `http://127.0.0.1:19000`                       |
| Region     | `us-east-1`                                    |
| Bucket     | `admin-base-acceptance`                        |
| Access Key | `admin-base-minio`                             |
| Secret Key | `admin-base-minio-secret`                      |
| Base URL   | `http://127.0.0.1:19000/admin-base-acceptance` |

保存后先执行“测试连接”。需要验证上传时，可临时设为默认存储，完成后必须恢复原默认存储。

### Mailpit SMTP

页面：`/system/mail/account`

| 字段                | 本地值                  |
| ------------------- | ----------------------- |
| 名称                | `Mailpit 本地验收`      |
| 编码                | `acceptance-mailpit`    |
| Host                | `127.0.0.1`             |
| Port                | `11025`                 |
| SSL/TLS             | 关闭                    |
| Username / Password | 留空                    |
| From Email          | `admin-base@local.test` |

测试收件人可使用 `acceptance@local.test`。邮件内容在
`http://127.0.0.1:18025` 查看。

### Keycloak OAuth

页面：`/system/oauth/provider`

| 字段          | 本地值                                                                           |
| ------------- | -------------------------------------------------------------------------------- |
| Key           | `keycloak-local`                                                                 |
| Name          | `Keycloak 本地验收`                                                              |
| Auth URL      | `http://127.0.0.1:18080/realms/admin-base/protocol/openid-connect/auth`          |
| Token URL     | `http://127.0.0.1:18080/realms/admin-base/protocol/openid-connect/token`         |
| UserInfo URL  | `http://127.0.0.1:18080/realms/admin-base/protocol/openid-connect/userinfo`      |
| Client ID     | `admin-base-local`                                                               |
| Client Secret | `admin-base-local-secret`                                                        |
| Scopes        | `openid profile email`                                                           |
| User Mapping  | `{"id":"sub","username":"preferred_username","email":"email","nickname":"name"}` |
| 自动创建用户  | 关闭                                                                             |

本地 OAuth 用户：

- Username：`admin-local-oauth`
- Password：`local-oauth-password`
- Email：`admin@xinadmin.test`

该邮箱与 seed 管理员匹配，用于验证已有用户自动绑定。回调地址已经写入 Keycloak realm：

```text
http://127.0.0.1:3000/api/system/oauth/keycloak-local/callback
http://localhost:3000/api/system/oauth/keycloak-local/callback
```

反向代理部署必须透传 `Host`、`X-Forwarded-Host` 和 `X-Forwarded-Proto`，Admin Base 会用这些
请求头生成 OAuth callback URL。生产 Provider 后台登记的 callback 必须与外部 HTTPS 域名完全一致。

### SMS Webhook

页面：`/system/sms/provider`

| 字段       | 本地值                            |
| ---------- | --------------------------------- |
| 名称       | `SMS Webhook 本地验收`            |
| 编码       | `acceptance-sms`                  |
| 服务商     | `webhook`                         |
| Endpoint   | `http://127.0.0.1:18081/sms/send` |
| Access Key | `acceptance-sms-access`           |
| Secret Key | `acceptance-sms-secret`           |
| 短信签名   | `Admin Base`                      |
| 模板编码   | `LOCAL_ACCEPTANCE`                |

Mock 收到的请求可通过以下地址检查：

```text
http://127.0.0.1:18081/__admin/requests?kind=sms
```

### AI Provider

页面：`/system/ai/provider`

| 字段          | 本地值                       |
| ------------- | ---------------------------- |
| 名称          | `OpenAI-compatible 本地验收` |
| 编码          | `acceptance-ai`              |
| Provider Type | `openai-compatible`          |
| Base URL      | `http://127.0.0.1:18081/v1`  |
| API Key       | `acceptance-ai-key`          |

可测试：

- 模型列表：不需要模型 ID。
- Chat：模型 ID 使用 `mock-chat`。
- Embedding：模型 ID 使用 `mock-embedding`。
- 流式 Chat：模型 ID 使用 `mock-chat`，预期文本为 `Local acceptance stream OK`。

需要测试模型管理时，在 `/system/ai/model` 新增 Chat 模型：

| 字段              | 本地值                       |
| ----------------- | ---------------------------- |
| Provider          | `OpenAI-compatible 本地验收` |
| 模型名称          | `Local Mock Chat`            |
| Model ID          | `mock-chat`                  |
| 模型类型          | `chat`                       |
| Context Window    | `32768`                      |
| Max Output Tokens | `4096`                       |

## 可选 Ollama

Ollama 不参与默认验收，避免首次拉取模型占用大量时间和磁盘。需要真实本地推理时：

```bash
docker compose -f compose.acceptance.yml --profile ollama up -d ollama
docker exec -it admin-base-acceptance-ollama-1 ollama pull <model-name>
```

Provider 使用：

```text
Provider Type: ollama
Base URL: http://127.0.0.1:11435/v1
API Key: 留空
```

模型名称和资源需求应按当前 Ollama 环境选择，不能把 Mock 验收结果当作真实模型质量结论。

## 验收边界

本地环境可以证明协议、配置加密、请求结构、回调、流式解析和资源清理正确，但不能证明：

- 云 S3 IAM、跨区域网络、CDN 和对象版本策略。
- 公网邮件投递率以及 SPF、DKIM、DMARC。
- GitHub、微信等平台审核和 Provider 特有授权策略。
- 运营商短信送达、签名和模板审核。
- 云模型配额、计费、内容审核和真实延迟。

这些项目仍需要在独立 staging 环境中使用最小权限的真实凭据完成最终验证。
