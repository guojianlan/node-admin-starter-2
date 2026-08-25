"use client";

import { memo, useMemo } from "react";
import { Typography } from "antd";
import { Streamdown, type Components } from "streamdown";
import { linkifyCitationMarkers } from "./citation-markers";

const baseComponents: Components = {
  p: ({ children }) => <p className="streaming-markdown-paragraph">{children}</p>,
  h1: ({ children }) => (
    <h1 className="streaming-markdown-heading streaming-markdown-h1">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="streaming-markdown-heading streaming-markdown-h2">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="streaming-markdown-heading streaming-markdown-h3">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="streaming-markdown-heading streaming-markdown-h4">{children}</h4>
  ),
  ul: ({ children }) => <ul className="streaming-markdown-list">{children}</ul>,
  ol: ({ children }) => <ol className="streaming-markdown-list">{children}</ol>,
  li: ({ children }) => <li className="streaming-markdown-list-item">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="streaming-markdown-blockquote">{children}</blockquote>
  ),
  inlineCode: ({ children, ...props }) => (
    <code {...props} className="streaming-markdown-inline-code">
      {children}
    </code>
  ),
  code: ({ children, ...props }) => (
    <code {...props} className="streaming-markdown-code">
      {children}
    </code>
  ),
  pre: ({ children }) => <pre className="streaming-markdown-pre">{children}</pre>,
  table: ({ children }) => (
    <div className="streaming-markdown-table-wrap">
      <table className="streaming-markdown-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="streaming-markdown-th">{children}</th>,
  td: ({ children }) => <td className="streaming-markdown-td">{children}</td>,
  hr: () => <hr className="streaming-markdown-divider" />,
};

export const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  className,
  placeholder = "等待模型返回内容...",
  minHeight = 160,
  maxHeight = 320,
  mode = "streaming",
  citationCount = 0,
  onCitationClick,
}: {
  content: string;
  className?: string;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number | null;
  mode?: "static" | "streaming";
  citationCount?: number;
  onCitationClick?: (citationNumber: number) => void;
}) {
  const renderedContent = useMemo(
    () => linkifyCitationMarkers(content, citationCount),
    [citationCount, content],
  );
  const components = useMemo<Components>(
    () => ({
      ...baseComponents,
      a: ({ children, href }) => {
        const citationNumber = href?.match(/^#citation-(\d+)$/)?.[1];
        if (citationNumber && onCitationClick) {
          const number = Number(citationNumber);
          return (
            <a
              href={href}
              className="streaming-markdown-citation-link"
              aria-label={`查看引用 ${number}`}
              onClick={(event) => {
                event.preventDefault();
                onCitationClick(number);
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
    }),
    [onCitationClick],
  );

  return (
    <div
      className={["streaming-markdown", className].filter(Boolean).join(" ")}
      style={{
        minHeight,
        maxHeight: maxHeight ?? undefined,
        overflow: maxHeight == null ? "visible" : "auto",
      }}
    >
      {renderedContent ? (
        <div className="streaming-markdown-content">
          <Streamdown mode={mode} components={components}>
            {renderedContent}
          </Streamdown>
        </div>
      ) : (
        <Typography.Text type="secondary">{placeholder}</Typography.Text>
      )}
    </div>
  );
});
