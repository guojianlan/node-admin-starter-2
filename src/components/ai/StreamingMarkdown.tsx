"use client";

import { memo } from "react";
import { Typography } from "antd";
import { Streamdown, type Components } from "streamdown";

const components: Components = {
  p: ({ children }) => <p className="streaming-markdown-paragraph">{children}</p>,
  h1: ({ children }) => <h1 className="streaming-markdown-heading streaming-markdown-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="streaming-markdown-heading streaming-markdown-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="streaming-markdown-heading streaming-markdown-h3">{children}</h3>,
  h4: ({ children }) => <h4 className="streaming-markdown-heading streaming-markdown-h4">{children}</h4>,
  ul: ({ children }) => <ul className="streaming-markdown-list">{children}</ul>,
  ol: ({ children }) => <ol className="streaming-markdown-list">{children}</ol>,
  li: ({ children }) => <li className="streaming-markdown-list-item">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="streaming-markdown-blockquote">{children}</blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
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
  pre: ({ children }) => (
    <pre className="streaming-markdown-pre">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="streaming-markdown-table-wrap">
      <table className="streaming-markdown-table">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="streaming-markdown-th">{children}</th>
  ),
  td: ({ children }) => (
    <td className="streaming-markdown-td">{children}</td>
  ),
  hr: () => <hr className="streaming-markdown-divider" />,
};

export const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  placeholder = "等待模型返回内容...",
  minHeight = 160,
  maxHeight = 320,
}: {
  content: string;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number | null;
}) {
  return (
    <div
      className="streaming-markdown"
      style={{
        minHeight,
        maxHeight: maxHeight ?? undefined,
        overflow: maxHeight == null ? "visible" : "auto",
      }}
    >
      {content ? (
        <div className="streaming-markdown-content">
          <Streamdown mode="streaming" components={components}>
            {content}
          </Streamdown>
        </div>
      ) : (
        <Typography.Text type="secondary">{placeholder}</Typography.Text>
      )}
    </div>
  );
});
