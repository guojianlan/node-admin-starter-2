function replaceLineCitationMarkers(line: string, citationCount: number) {
  let result = "";
  let index = 0;
  let inlineCodeTicks = 0;

  while (index < line.length) {
    if (line[index] === "`") {
      let ticks = 1;
      while (line[index + ticks] === "`") ticks += 1;
      if (inlineCodeTicks === 0) inlineCodeTicks = ticks;
      else if (inlineCodeTicks === ticks) inlineCodeTicks = 0;
      result += line.slice(index, index + ticks);
      index += ticks;
      continue;
    }

    if (inlineCodeTicks === 0 && line[index] === "[") {
      const closing = line.indexOf("]", index + 1);
      const rawNumber = closing > index ? line.slice(index + 1, closing) : "";
      const citationNumber = /^\d+$/.test(rawNumber) ? Number(rawNumber) : 0;
      if (citationNumber >= 1 && citationNumber <= citationCount) {
        result += `[[${citationNumber}]](#citation-${citationNumber})`;
        index = closing + 1;
        continue;
      }
    }

    result += line[index];
    index += 1;
  }

  return result;
}

export function linkifyCitationMarkers(content: string, citationCount: number) {
  if (!content || citationCount <= 0) return content;

  let fence: { marker: "`" | "~"; length: number } | null = null;
  return content
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (match) {
        const marker = match[1][0] as "`" | "~";
        const length = match[1].length;
        if (!fence) fence = { marker, length };
        else if (fence.marker === marker && length >= fence.length) fence = null;
        return line;
      }
      return fence ? line : replaceLineCitationMarkers(line, citationCount);
    })
    .join("\n");
}
