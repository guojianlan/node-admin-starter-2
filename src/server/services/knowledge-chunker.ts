export const KNOWLEDGE_CHUNKER_VERSION = "structure-aware-v1";

export type KnowledgeChunkPreset =
  | "auto"
  | "documentation"
  | "paragraph"
  | "sentence"
  | "recursive"
  | "fixed";

export type KnowledgeChunkConfig = {
  preset: KnowledgeChunkPreset;
  targetChars: number;
  overlapChars: number;
  preserveHeadings: boolean;
  preserveCodeBlocks: boolean;
  sentenceBoundaryFallback: boolean;
};

export type KnowledgeChunk = {
  content: string;
  paragraphStart: number;
  paragraphEnd: number;
  heading: string | null;
  tokenCount: number;
};

type SemanticUnit = {
  content: string;
  paragraphStart: number;
  paragraphEnd: number;
  heading: string | null;
  kind: "heading" | "paragraph" | "sentence" | "code" | "fixed";
};

const PRESET_DEFAULTS: Record<KnowledgeChunkPreset, Omit<KnowledgeChunkConfig, "preset">> = {
  auto: {
    targetChars: 1600,
    overlapChars: 160,
    preserveHeadings: true,
    preserveCodeBlocks: true,
    sentenceBoundaryFallback: true,
  },
  documentation: {
    targetChars: 1600,
    overlapChars: 160,
    preserveHeadings: true,
    preserveCodeBlocks: true,
    sentenceBoundaryFallback: true,
  },
  paragraph: {
    targetChars: 1400,
    overlapChars: 140,
    preserveHeadings: true,
    preserveCodeBlocks: true,
    sentenceBoundaryFallback: true,
  },
  sentence: {
    targetChars: 900,
    overlapChars: 90,
    preserveHeadings: true,
    preserveCodeBlocks: true,
    sentenceBoundaryFallback: true,
  },
  recursive: {
    targetChars: 1400,
    overlapChars: 140,
    preserveHeadings: true,
    preserveCodeBlocks: true,
    sentenceBoundaryFallback: true,
  },
  fixed: {
    targetChars: 1200,
    overlapChars: 120,
    preserveHeadings: false,
    preserveCodeBlocks: false,
    sentenceBoundaryFallback: false,
  },
};

export const knowledgeChunkPresetOptions = Object.freeze(
  Object.entries(PRESET_DEFAULTS).map(([preset, config]) => ({
    preset: preset as KnowledgeChunkPreset,
    ...config,
  })),
);

export function getKnowledgeChunkPresetDefaults(preset: KnowledgeChunkPreset) {
  return { preset, ...PRESET_DEFAULTS[preset] } satisfies KnowledgeChunkConfig;
}

export function resolveKnowledgeChunkConfig(
  input: Partial<KnowledgeChunkConfig> & { preset?: KnowledgeChunkPreset },
  format?: string | null,
): KnowledgeChunkConfig {
  const requestedPreset = input.preset ?? "auto";
  const resolvedPreset =
    requestedPreset === "auto"
      ? ["md", "markdown"].includes((format ?? "").toLowerCase())
        ? "documentation"
        : "recursive"
      : requestedPreset;
  const defaults = PRESET_DEFAULTS[resolvedPreset];
  const targetChars = Math.floor(input.targetChars ?? defaults.targetChars);
  const overlapChars = Math.floor(input.overlapChars ?? defaults.overlapChars);
  if (!Number.isInteger(targetChars) || targetChars < 32 || targetChars > 12000) {
    throw new Error("分块目标长度必须是 32 到 12000 之间的整数");
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars > 2000) {
    throw new Error("分块重叠长度必须是 0 到 2000 之间的整数");
  }
  if (overlapChars >= targetChars || overlapChars > Math.floor(targetChars * 0.35)) {
    throw new Error("分块重叠长度必须小于目标长度的 35%");
  }
  return {
    preset: resolvedPreset,
    targetChars,
    overlapChars,
    preserveHeadings: input.preserveHeadings ?? defaults.preserveHeadings,
    preserveCodeBlocks: input.preserveCodeBlocks ?? defaults.preserveCodeBlocks,
    sentenceBoundaryFallback: input.sentenceBoundaryFallback ?? defaults.sentenceBoundaryFallback,
  };
}

function normalizeText(value: string) {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll(/\n{4,}/g, "\n\n\n")
    .trim();
}

function roughTokenCount(value: string) {
  const cjkCharacters = value.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  const remaining = Math.max(0, value.length - cjkCharacters);
  return Math.max(1, Math.ceil(cjkCharacters + remaining / 4));
}

function splitAtBoundary(value: string, maxChars: number) {
  const window = value.slice(0, Math.max(1, maxChars + 1));
  const minIndex = Math.floor(maxChars * 0.55);
  for (let index = Math.min(window.length - 1, maxChars); index >= minIndex; index -= 1) {
    if (/[\n。！？!?；;，,、\s]/u.test(window[index])) return Math.max(1, index + 1);
  }
  return maxChars;
}

function splitLongText(value: string, maxChars: number, preferBoundaries: boolean) {
  const parts: string[] = [];
  let remaining = value.trim();
  while (remaining.length > maxChars) {
    const splitIndex = preferBoundaries ? splitAtBoundary(remaining, maxChars) : maxChars;
    parts.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }
  if (remaining) parts.push(remaining);
  return parts.filter(Boolean);
}

function splitSentences(value: string) {
  return (value.match(/[^。！？!?；;\n]+(?:[。！？!?；;]+|$)/gu) ?? [value])
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMarkdownUnits(text: string): SemanticUnit[] {
  const lines = text.split("\n");
  const units: SemanticUnit[] = [];
  let paragraphNo = 0;
  let heading: string | null = null;
  let buffer: string[] = [];
  let inFence = false;
  let fence: string | null = null;

  const flush = (kind: SemanticUnit["kind"] = inFence ? "code" : "paragraph") => {
    const content = buffer.join("\n").trim();
    buffer = [];
    if (!content) return;
    paragraphNo += 1;
    units.push({
      content,
      paragraphStart: paragraphNo,
      paragraphEnd: paragraphNo,
      heading,
      kind,
    });
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (!inFence) {
        flush();
        inFence = true;
        fence = fenceMatch[1];
        buffer.push(line);
      } else {
        buffer.push(line);
        if (line.trimStart().startsWith(fence ?? "```")) {
          inFence = false;
          fence = null;
          flush("code");
        }
      }
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flush();
      heading = headingMatch[1]?.trim() || null;
      paragraphNo += 1;
      units.push({
        content: line.trim(),
        paragraphStart: paragraphNo,
        paragraphEnd: paragraphNo,
        heading,
        kind: "heading",
      });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush(inFence ? "code" : "paragraph");
  return units;
}

function parseParagraphUnits(text: string): SemanticUnit[] {
  let heading: string | null = null;
  return text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((content, index) => {
      const headingMatch = content.match(/^#{1,6}\s+(.+?)(?:\n|$)/);
      if (headingMatch) heading = headingMatch[1]?.trim() || heading;
      return {
        content,
        paragraphStart: index + 1,
        paragraphEnd: index + 1,
        heading,
        kind: headingMatch ? "heading" : "paragraph",
      } satisfies SemanticUnit;
    });
}

function expandUnits(units: SemanticUnit[], maxCoreChars: number, config: KnowledgeChunkConfig) {
  return units.flatMap((unit) => {
    if (unit.content.length <= maxCoreChars) return [unit];
    const parts =
      config.preset === "sentence"
        ? splitSentences(unit.content).flatMap((sentence) =>
            splitLongText(sentence, maxCoreChars, true),
          )
        : splitLongText(unit.content, maxCoreChars, config.sentenceBoundaryFallback);
    return parts.map((content) => ({ ...unit, content }));
  });
}

function packUnits(units: SemanticUnit[], maxCoreChars: number) {
  const groups: SemanticUnit[][] = [];
  let current: SemanticUnit[] = [];
  let currentLength = 0;
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
    currentLength = 0;
  };
  for (const unit of units) {
    const separatorLength = current.length ? 2 : 0;
    if (current.length && currentLength + separatorLength + unit.content.length > maxCoreChars) {
      flush();
    }
    current.push(unit);
    currentLength += (current.length > 1 ? 2 : 0) + unit.content.length;
  }
  flush();
  return groups;
}

function tailContext(value: string, limit: number) {
  if (limit <= 0) return "";
  const normalized = value.trim();
  if (normalized.length <= limit) return normalized;
  const candidate = normalized.slice(-limit).trim();
  const boundary = candidate.search(/[\n。！？!?；;]/u);
  if (boundary >= 0 && boundary < Math.floor(candidate.length * 0.45)) {
    return candidate.slice(boundary + 1).trim();
  }
  return candidate;
}

export function chunkKnowledgeDocument(input: {
  text: string;
  format?: string | null;
  config?: Partial<KnowledgeChunkConfig> & { preset?: KnowledgeChunkPreset };
}) {
  const normalized = normalizeText(input.text);
  if (!normalized) return [];
  const config = resolveKnowledgeChunkConfig(input.config ?? {}, input.format);
  if (config.preset === "fixed") {
    const step = config.targetChars - config.overlapChars;
    return Array.from({
      length: Math.ceil(Math.max(1, normalized.length - config.overlapChars) / step),
    })
      .map((_, index) => normalized.slice(index * step, index * step + config.targetChars).trim())
      .filter(Boolean)
      .map((content, index) => ({
        content,
        paragraphStart: index + 1,
        paragraphEnd: index + 1,
        heading: null,
        tokenCount: roughTokenCount(content),
      }));
  }

  const maxCoreChars = Math.max(1, config.targetChars - config.overlapChars);
  const parsed =
    config.preset === "documentation"
      ? parseMarkdownUnits(normalized)
      : parseParagraphUnits(normalized);
  const units =
    config.preset === "sentence"
      ? parsed.flatMap((unit) =>
          splitSentences(unit.content).map((content) => ({
            ...unit,
            content,
            kind: "sentence" as const,
          })),
        )
      : parsed;
  const coreGroups = packUnits(expandUnits(units, maxCoreChars, config), maxCoreChars);
  const coreContents = coreGroups.map((group) => group.map((unit) => unit.content).join("\n\n"));

  return coreGroups.map((group, index) => {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const overlapSource =
      index > 0
        ? coreGroups[index - 1]!.filter((unit) => unit.kind !== "code" && unit.kind !== "heading")
            .map((unit) => unit.content)
            .join("\n\n")
        : "";
    const overlap = tailContext(overlapSource, config.overlapChars);
    const activeHeading =
      [...group].reverse().find((unit) => unit.kind === "heading")?.heading ?? first.heading;
    const headingPrefix =
      config.preserveHeadings && activeHeading && !coreContents[index]!.includes(activeHeading)
        ? `# ${activeHeading}`
        : "";
    const content = [headingPrefix, overlap, coreContents[index]]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    return {
      content,
      paragraphStart: first.paragraphStart,
      paragraphEnd: last.paragraphEnd,
      heading: activeHeading,
      tokenCount: roughTokenCount(content),
    } satisfies KnowledgeChunk;
  });
}
