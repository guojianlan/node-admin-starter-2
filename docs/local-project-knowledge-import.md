# 本机项目知识库导入

Admin Base 可以把本机项目目录的白名单元数据和项目文档导入 Knowledge/RAG，方便在后台统一搜索项目用途、技术栈、命令和 README 说明。

## 默认命令

```bash
pnpm ai:knowledge:import-projects
```

默认扫描 `/Users/apple/Desktop/project`，创建或更新全局知识库 `local-project-catalog`，使用“技术文档”分块模板。重复执行时，相同内容按 SHA-256 跳过；同名内容变化会创建新文档版本并停用旧版本。

只生成本地 Markdown、不上传和索引：

```bash
pnpm ai:knowledge:import-projects -- --generate-only
```

指定其他目录：

```bash
pnpm ai:knowledge:import-projects -- --project-root=/absolute/project/root
```

生成文件位于 `generated/knowledge/local-project-catalog`，该目录已加入 `.gitignore`。成功导入后可在 `/system/ai/knowledge` 选择“本机项目知识库”进行检索和有引用问答。

## 读取边界

导入器只读取项目根目录的以下信息：

- Git 当前分支，不读取远端 URL。
- `README.md` 或 `README` 的有限摘要。
- `package.json` 的名称、说明、包管理器、脚本名和依赖名。
- `go.mod`、`Cargo.toml` 是否存在，用于识别技术栈。
- Admin Base 自身 `docs/knowledge/*.md` 专题文档。

导入器不读取源码、`.env*`、凭据目录、数据库、日志、构建产物、`node_modules`、`.next`、候选人数据、输出目录和备份目录。文本进入文件管理前会再次脱敏常见 API Key、Bearer Token、Secret 赋值、带密码 URL 和私钥块。

## 外部调用与前置条件

导入索引会调用当前 `embedding` 用途路由，检索时可能调用 `rerank` 用途路由。因此 README 摘要会发送给所配置的外部 AI Provider。执行前应确认这些项目文档允许发送给该 Provider。

需要先完成：

1. `pnpm db:migrate` 和 `pnpm db:seed`。
2. 配置可用的默认本地或 S3 存储。
3. 配置启用的 Embedding 模型及 `embedding` 用途路由。
4. 可选配置 Rerank 模型及 `rerank` 用途路由。

脚本不会执行 `db:reset`，也不会删除源项目文件。导入结果和失败会写入 `sys_operation_log`，日志只记录数量、路径和脱敏错误，不记录文档正文或 Provider Secret。
