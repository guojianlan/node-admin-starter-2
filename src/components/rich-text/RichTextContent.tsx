"use client";

import { sanitizeRichTextHtml } from "@/lib/rich-text";

type RichTextContentProps = {
  html?: string | null;
  className?: string;
};

export function RichTextContent({ html, className }: RichTextContentProps) {
  return (
    <div
      className={["rich-text-content", className].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(html) }}
    />
  );
}
