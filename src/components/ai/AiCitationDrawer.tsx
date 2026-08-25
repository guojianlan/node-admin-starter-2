"use client";

import type { ReactNode } from "react";
import { FileTextOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Collapse, Drawer, Tag, Tooltip, Typography } from "antd";
import { StreamingMarkdown } from "./StreamingMarkdown";

export function AiCitationDrawer({
  open,
  citationNumber,
  citationCount,
  documentName,
  knowledgeBaseName,
  chunkNo,
  pageNumber,
  score,
  content,
  details,
  onClose,
  onPrevious,
  onNext,
}: {
  open: boolean;
  citationNumber: number;
  citationCount: number;
  documentName: string;
  knowledgeBaseName: string;
  chunkNo: number;
  pageNumber?: number | null;
  score?: number | null;
  content: string;
  details?: ReactNode;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const hasNavigation = citationCount > 1 && citationNumber > 0;

  return (
    <Drawer
      title={
        <span className="ai-citation-drawer-title">
          <span className="ai-citation-drawer-index">[{citationNumber || 1}]</span>
          <span>来源</span>
        </span>
      }
      open={open}
      size="min(520px, 100vw)"
      zIndex={1100}
      rootClassName="ai-citation-drawer"
      onClose={onClose}
      footer={
        hasNavigation ? (
          <div className="ai-citation-drawer-navigation">
            <Tooltip title="上一条引用">
              <Button
                type="text"
                icon={<LeftOutlined />}
                aria-label="上一条引用"
                disabled={!onPrevious}
                onClick={onPrevious}
              />
            </Tooltip>
            <Typography.Text type="secondary">
              {citationNumber} / {citationCount}
            </Typography.Text>
            <Tooltip title="下一条引用">
              <Button
                type="text"
                icon={<RightOutlined />}
                aria-label="下一条引用"
                disabled={!onNext}
                onClick={onNext}
              />
            </Tooltip>
          </div>
        ) : null
      }
    >
      <article className="ai-citation-inspector">
        <header className="ai-citation-source-header">
          <span className="ai-citation-source-icon" aria-hidden="true">
            <FileTextOutlined />
          </span>
          <div className="ai-citation-source-heading">
            <Typography.Title level={5} title={documentName}>
              {documentName}
            </Typography.Title>
            <Typography.Text type="secondary" title={knowledgeBaseName}>
              {knowledgeBaseName}
            </Typography.Text>
          </div>
        </header>

        <div className="ai-citation-source-meta">
          <Tag>分块 {chunkNo}</Tag>
          {pageNumber ? <Tag>第 {pageNumber} 页</Tag> : null}
          {score != null ? <Tag color="processing">匹配 {(score * 100).toFixed(1)}%</Tag> : null}
        </div>

        <section className="ai-citation-excerpt-section">
          <Typography.Text className="ai-citation-section-label">引用原文</Typography.Text>
          <StreamingMarkdown
            className="ai-citation-excerpt"
            content={content}
            placeholder="该引用没有可展示的正文"
            minHeight={0}
            maxHeight={null}
            mode="static"
          />
        </section>

        {details ? (
          <Collapse
            ghost
            size="small"
            className="ai-citation-details"
            items={[{ key: "details", label: "检索详情", children: details }]}
          />
        ) : null}
      </article>
    </Drawer>
  );
}
