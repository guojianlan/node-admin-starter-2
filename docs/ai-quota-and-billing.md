# AI 配额与计费账本

Updated: 2026-08-24

当前实现提供 AI 用量治理和结算证据基础，不是完整多租户财务系统。模型目录价格用于估算，Provider
官方账单或合同价格仍是最终结算真值。

## 1. 配额

`sys_ai_quota_policy` 支持：

- 主体：`system`、`department`、`user`。
- 周期：`daily`、`monthly`。
- 限制：输入 Token、输出 Token、指定币种费用。
- 状态：启用或停用。

Provider 调用前会读取当前用户、部门和系统策略。user 汇总单用户，department 汇总部门所有用户，
system 汇总全系统；任何适用策略达到上限均返回 HTTP 429。费用只汇总与策略币种一致且未 void 的
usage Ledger。

这不是 tenant 隔离。没有 tenant ID、租户级认证、租户数据范围或租户账单，不能把 department 当成
完整租户替代品。

通用 SaaS 的 Tenant/Workspace/Module/Metric 用量已由 Foundation F3 独立实现，见
[`saas-foundation-f3-usage-quota.md`](./saas-foundation-f3-usage-quota.md)。F3 使用 Plan/Subscription、策略继承、
Reservation 和追加式 Usage Ledger；它不会读取或回填本表，也不会把 AI department policy 当成 Tenant Plan。

## 2. 账本

每个成功并有估算费用的 Invocation 最多生成一条 `usage` Ledger：

- amount/currency 来自调用时模型价格快照和实际 Token。
- 初始状态为 `estimated`，来源为 `runtime_estimate`。
- 管理员可将 usage 更新为 `confirmed` 或 `void`，并覆盖确认金额、币种、来源和说明。
- 管理员可写入正数或负数 `adjustment`，用于补录、冲减或修正。
- adjustment 和 settlement 是 critical 风险写操作并写 operation log。

账本不保存 Prompt、回复正文、API Key 或 Provider Token。

## 3. 权限和页面

治理页：`/system/ai/governance?tab=operations`。

- 查询：`system.aiGovernance.query`。
- 配额、人工 adjustment、confirmed/void：`system.aiGovernance.update`。
- Job 执行、重试和取消：`system.aiGovernance.execute`。

## 4. 结算边界

当前没有：

- 租户账单周期和关账。
- Invoice、应收、支付、退款、税率和发票号码。
- Provider 官方账单导入、自动对账和差异处理。
- 多币种汇率换算。
- 预付余额、信用额度和硬性财务扣款。

引入正式商业计费前，应增加 tenant、billing account、period、invoice、invoice line、payment 和
Provider statement/reconciliation 模型，并由财务规则审查，而不是直接扩展现有估算表。

Foundation F3 已补充前置的 Tenant Plan、Subscription 和业务用量事实，但仍没有 billing account、Invoice、
Payment、Tax、Refund、关账或 Provider statement 对账，因此不能把 F3 Usage Ledger 称为正式财务账本。
