# Admin Base AI Runtime 与 Knowledge/RAG

## AI 资源关系

AI Provider 保存服务商连接信息，例如 Base URL、加密 API Key、网络超时和启用状态。AI Model 属于一个 Provider，保存模型 ID、能力、上下文窗口和最大输出。用途路由为 Chat、Structured、Embedding、Rerank、Agent、RAG Answer 和 Eval Judge 维护有序模型列表。

一次调用先根据用途选择模型，再通过 `model.providerId` 找到连接配置。主模型失败后按用途路由优先级尝试候选模型。每次 Invocation 和 Attempt 都记录状态、延迟、Token、估算费用和脱敏错误，Provider 健康页据此计算成功率与 P50/P95。

## Knowledge/RAG 链路

知识库支持全局、部门和个人可见范围。来源文档来自文件管理，当前支持 TXT、Markdown、PDF 和 DOCX。索引流程提取文本、按知识库配置分块、批量生成 Embedding，并把分块、元数据和向量写入 PostgreSQL。

检索先进行 PostgreSQL 全文召回和向量余弦召回，再融合候选分数。启用 Rerank 用途模型时，对有限候选集重排；Rerank 失败会保留混合检索顺序并记录降级信息。RAG Answer 只接收最终引用片段，资料不足时应明确回答证据不足。

## 分块策略

默认 `auto` 不执行固定长度硬切。Markdown 使用技术文档模式，保留标题、段落、列表和代码块；PDF、DOCX、TXT 使用递归语义边界。可选模板还包括段落聚合、句子边界、递归语义边界和兼容用固定长度。

知识库保存目标字符数和上下文重叠。实际索引时会把解析后的模板、参数与 chunker 版本保存到文档和分块元数据。修改知识库配置后必须重新索引已有文档，旧索引不会被伪装成新策略结果。
