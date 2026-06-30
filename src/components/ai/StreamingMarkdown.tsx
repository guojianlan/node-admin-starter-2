"use client";

import { memo, type CSSProperties } from "react";
import { Typography } from "antd";
import { Streamdown, type Components } from "streamdown";

const textStyle: CSSProperties = {
  color: "#1f2937",
  fontSize: 14,
  lineHeight: 1.75,
  margin: 0,
};

const headingStyle: CSSProperties = {
  color: "#111827",
  fontWeight: 600,
  lineHeight: 1.45,
  margin: "10px 0 6px",
};

const components: Components = {
  p: ({ children }) => <p style={textStyle}>{children}</p>,
  h1: ({ children }) => <h1 style={{ ...headingStyle, fontSize: 18 }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ ...headingStyle, fontSize: 16 }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ ...headingStyle, fontSize: 15 }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ ...headingStyle, fontSize: 14 }}>{children}</h4>,
  ul: ({ children }) => (
    <ul style={{ ...textStyle, margin: "4px 0", paddingLeft: 22 }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ ...textStyle, margin: "4px 0", paddingLeft: 22 }}>{children}</ol>
  ),
  li: ({ children }) => <li style={{ margin: "2px 0" }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "3px solid #1677ff",
        background: "#f5f9ff",
        margin: "8px 0",
        padding: "6px 10px",
        color: "#374151",
      }}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  inlineCode: ({ children, ...props }) => (
    <code
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 4,
        background: "#f9fafb",
        color: "#111827",
        fontSize: 13,
        padding: "1px 4px",
      }}
      {...props}
    >
      {children}
    </code>
  ),
  code: ({ children, ...props }) => (
    <code
      style={{
        display: "block",
        color: "#111827",
        fontSize: 13,
        lineHeight: 1.65,
        whiteSpace: "pre",
      }}
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        background: "#f9fafb",
        margin: "8px 0",
        overflowX: "auto",
        padding: "10px 12px",
      }}
    >
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "8px 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: "1px solid #e5e7eb",
        background: "#f9fafb",
        padding: "6px 8px",
        textAlign: "left",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ border: "1px solid #e5e7eb", padding: "6px 8px" }}>{children}</td>
  ),
  hr: () => <hr style={{ border: 0, borderTop: "1px solid #e5e7eb", margin: "10px 0" }} />,
};

export const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  placeholder = "等待模型返回内容...",
}: {
  content: string;
  placeholder?: string;
}) {
  return (
    <div
      style={{
        minHeight: 160,
        maxHeight: 320,
        overflow: "auto",
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        background: "#ffffff",
        padding: 12,
      }}
    >
      {content ? (
        <div style={{ display: "grid", gap: 8 }}>
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
