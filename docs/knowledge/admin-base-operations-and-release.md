# Admin Base 运维与发布

## 启动与数据库

开发环境使用 `pnpm dev`。数据库结构由项目 migration 定义，使用 `pnpm db:migrate`；系统基础数据使用 `pnpm db:seed`。生产部署禁止把 `pnpm db:reset` 当作迁移、测试或恢复手段。

生产 readiness 由未鉴权 `/api/ready` 提供，鉴权后的 `/api/system/doctor` 检查环境变量、数据库、migration、管理员、默认存储、存储连接、上传目录、默认邮件和生产安全项。

## 文件与外部服务

文件可以存储在本地目录或 S3 兼容服务。默认存储必须可连接，上传目录或 Bucket 需要持久化和备份。危险扩展名、MIME 与魔数校验、分片上传临时目录、回收站引用保护都属于生产边界。

SMTP、OAuth、SMS 和 AI Provider 是资源型配置，不合并进普通配置项。系统设置页只做 UI 聚合。真实外部验收应使用专用测试账号和最小权限凭据，不能把 Secret 写入文档、截图、命令历史或操作日志详情。

## 发布检查

发布前至少执行类型检查、Lint、测试、路由权限检查和生产构建。CI 使用 PostgreSQL service 在空库执行 migration、seed 和质量门禁。Smoke 不清库，只验证登录、主要页面和关键 API。
