# AI Notebook 引用体验与实现边界

> 当前核对：2026-08-24
> 目标：说明 Admin Base 的 Notebook/RAG 引用为什么这样设计、哪些结论来自公开资料，以及哪些实现属于本项目自己的工程选择。

## 1. NotebookLM 可确认的产品原则

Google 没有公开 NotebookLM 的完整服务端源码，也没有一篇足以复现其检索、Prompt、排序和引用
生成链路的官方工程论文。不能把外部推测当成 Google 的真实实现。

公开资料能确认的是：

- NotebookLM 是围绕用户选择的来源进行 source grounding，而不是让模型无边界回答。
- 回答携带引用和相关原文，目的是让用户能回到原始证据进行事实核对。
- 生成内容只是所选来源的反映，不等于全面、客观或已经验证的事实。
- 多模态来源和长上下文由 Gemini 能力支撑，但公开资料没有披露完整的 Chunk、召回、Rerank、
  Citation Alignment 和缓存实现。
- NotebookLM 支持把公开网站作为来源，但只导入页面文本；图片、嵌入视频、嵌套页面和付费墙内容不会随 URL 自动导入。
- 2026 年 3 月的官方更新把对来源提问、研究和内容创建继续收拢到 Notebook 主工作区：用户从自然语言意图开始，长时间运行的工作保持可恢复和可检查，高级选项不应打断主要输入流程。

来源：

- [Introducing NotebookLM](https://blog.google/technology/ai/notebooklm-google-ai/)
- [NotebookLM now lets you listen to a conversation about your sources](https://blog.google/technology/ai/notebooklm-audio-overviews/)
- [Add or discover new sources for your notebook](https://support.google.com/notebooklm/answer/16215270?hl=en)
- [New ways to customize and interact with your content in NotebookLM](https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html)

## 2. 可参考的开源项目

Google NotebookLM 本身不是开源项目。可参考的项目只能作为替代产品或交互实现样本，不能称为
NotebookLM 源码。

### Open Notebook

[lfnovo/open-notebook](https://github.com/lfnovo/open-notebook) 是 MIT 许可的开源替代方案。当前实现
使用 Next.js、React、Python、SurrealDB 和 LangGraph。与引用相关的做法包括：

1. 在上下文中保留 `source`、`note`、`source_insight` 等稳定 ID。
2. 将模型返回的稳定引用标记去重并编号。
3. 把编号转换成 Markdown link，并通过自定义 link renderer 变成可点击引用。
4. 点击后按稳定 ID 打开对应来源，而不是从显示标题反查来源。

这套做法证明了“稳定来源 ID + 紧凑编号 + 独立来源检查器”的工程可行性，但它的检索与引用质量
不代表 Google NotebookLM。

### SurfSense

[MODSetter/SurfSense](https://github.com/MODSetter/SurfSense) 是面向开放网络研究的开源替代方案，
强调全文与向量检索、外部连接器、带引用回答和研究产物。它适合参考来源接入、MCP 和协作边界，
不适合直接复制为 Admin Base 的运行架构。

## 3. Admin Base 的引用链路

本项目采用可审计、可定位的显式链路：

```text
Notebook / Knowledge 选择有效来源
  -> Chunker 保留 documentId、chunkId、页码和段落位置
  -> 混合检索与可选 Rerank 生成有序候选
  -> RAG Run 保存 Citation Snapshot
  -> 模型回答只引用当前候选的 [n]
  -> 前端把 [n] 映射到同一次 Run 的 citations[n - 1]
  -> 点击编号打开来源检查器
```

网站来源不会形成第二套 RAG：系统先安全抓取公开 HTML、提取正文并保存 Markdown 快照，随后把快照作为
`sys_file -> sys_ai_document -> sys_ai_document_chunk` 处理。来源列表额外展示网站标题、域名、抓取时间
和原网页入口；历史回答继续引用当时的文档/Chunk 快照，即使原网页后来发生变化也不会静默改写证据。

联网搜索同样不会绕过来源链路。搜索 Provider 只返回候选 URL、标题和摘要；用户选中的 URL 会重新经过
SSRF 防护、逐跳重定向校验、正文提取和快照索引，搜索摘要本身永远不作为知识正文。Deep Research 在
Workflow Step 中保存计划、检索、导入和报告证据，最终报告只允许引用本次成功导入的文档。

知识上传与普通文件管理共享底层存储，但不共享管理列表。直接上传的来源标记为 `knowledge`，普通文件管理
只处理 `general`。从文件库导入不是共享同一条 `sys_file` 引用，而是复制物理对象并创建独立的
`knowledge` 文件快照；原文件的移动、修改、软删除或物理删除不会改变知识库已有内容。未来 C 端业务上传
使用独立的 `user_content` 域，避免管理员素材、用户内容和知识来源互相污染。

Notebook 主工作区把“问来源”和“联网研究”放在同一个底部输入框。问来源只检索当前有效来源；联网研究
把自然语言目标交给既有 Deep Research Workflow，由模型规划互补检索词、搜索候选、重新安全抓取、建立
知识快照并生成引用报告。检索方向数和最多来源数属于高级参数，只在紧凑设置层中出现；排队或运行中的
任务在输入框上方保留可见状态并可直接回到 Run/Step 证据。

引用快照保存来源版本和原文片段，因此来源后续重新索引时，历史 Artifact 仍能说明当时使用了什么
证据。前端编号只是展示索引，真实定位依赖 `documentId` 和 `chunkId`。

## 4. 交互规则

Notebook 和 Knowledge 统一遵循：

- 正文中只显示紧凑引用编号，不插入会打断阅读的大型引用标签云。
- 点击编号从右侧打开来源检查器，不离开当前问题和阅读位置。
- 检查器先显示文档、知识库、分块/页码和引用原文。
- 检索分数、Rerank Trace 和降级原因属于开发诊断信息，默认收进“检索详情”。
- 长代码、长单词和宽表格必须限制在检查器内部；代码和表格只在自己的区域横向滚动。
- 多条引用支持上一条、下一条切换；关闭后回到原回答，不改变回答滚动位置。
- Artifact 使用生成时保存的引用快照，不能静默替换成重新索引后的最新 Chunk。

## 5. 当前边界

当前引用点击能定位到保存的 Chunk 或 Artifact Quote，但还不是完整文档阅读器。后续只有在业务需要时
再增加 PDF 页级定位、原文关键词高亮、左右对照阅读和引用覆盖率可视化，不在引用 Drawer 中堆叠
这些能力。
