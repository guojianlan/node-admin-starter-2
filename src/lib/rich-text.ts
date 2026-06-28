import sanitizeHtml, { type IOptions } from "sanitize-html";

const richTextSanitizeOptions: IOptions = {
  allowedTags: [
    "a",
    "blockquote",
    "br",
    "code",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "hr",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "strong",
    "ul",
  ],
  allowedAttributes: {
    a: ["href", "rel", "target", "title"],
    img: ["alt", "src", "title"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer",
      target: "_blank",
    }),
  },
};

const plainTextOptions: IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  textFilter: (text) => text.replace(/\s+/g, " "),
};

export function sanitizeRichTextHtml(value: unknown) {
  return sanitizeHtml(String(value ?? ""), richTextSanitizeOptions).trim();
}

export function richTextToPlainText(value: unknown) {
  return sanitizeHtml(String(value ?? ""), plainTextOptions).replace(/\s+/g, " ").trim();
}

export function hasMeaningfulRichTextContent(value: unknown) {
  const html = String(value ?? "");
  return richTextToPlainText(html).length > 0 || /<img\s/i.test(html);
}
