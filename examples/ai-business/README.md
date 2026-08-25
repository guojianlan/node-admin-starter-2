# AI Business Examples

本目录提供虚构的 CRM、供应链和企业知识库样例，用于验证 Admin Base 的 Knowledge、Notebook、Agent
设计和后续业务模块。所有公司、人员、交易和金额均为虚构数据。

## 文件

```text
data/crm-demo-data.json
data/supply-chain-demo-data.json
knowledge/company-product-handbook.md
knowledge/crm-customer-success-playbook.md
knowledge/data-access-policy.md
knowledge/supply-chain-risk-playbook.md
```

## 快速试用

在已经执行 migration、配置默认存储和 Embedding 模型的开发环境运行：

```bash
pnpm ai:import:business-examples -- --generate-artifact
```

脚本会幂等创建或更新：

- 文件管理中的“AI 业务示例”分组、五份知识文档和两份 JSON 数据夹具。
- `/system/ai/knowledge` 中的“北辰科技内部知识库”及其已索引来源。
- `/system/ai/notebook` 中的“星河精密客户方案”和知识库来源。
- 一个可运行的企业知识方案助手，以及 CRM、经营分析和供应链三个未启用模板 Agent。
- 对应 Runtime Skills 和“AI 业务场景验收示例”Eval 数据集。
- 使用 `--generate-artifact` 时，尝试生成一份带引用的客户方案内容稿；Provider 不可用不会撤销其他导入结果。

也可以不运行脚本，手工完成：

1. 在文件管理创建“AI 业务示例”分组。
2. 上传 `knowledge` 目录下四份 Markdown。
3. 在 `/system/ai/knowledge` 创建“北辰科技内部知识库”。
4. 添加文件并索引到 ready。
5. 在 `/system/ai/notebook` 创建“星河精密客户方案”，添加产品手册和客户成功手册。
6. 提问“如何为制造业客户设计降低停机时间的方案”，检查引用。
7. 生成结构化简报 Artifact。

JSON 数据是业务模块设计和 API/Tool 测试夹具，不会被当前系统自动导入。CRM 和供应链表需要按
[`docs/ai-business-use-case-cookbook.md`](../../docs/ai-business-use-case-cookbook.md) 的模块契约实现。
导入脚本只把 JSON 放入文件管理供查看，不会把客户或供应链事实错误写入 Knowledge、Memory 或尚不存在的
业务表。
