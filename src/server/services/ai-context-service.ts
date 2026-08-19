import type { AiChatMessageRow } from "./ai-chat-service";
import type { AiRuntimeMessage } from "./ai-runtime-service";

const minimumContextBudget = 2048;
const summaryCharacterLimit = 6000;

export function estimateAiTokens(value: string) {
  if (!value) return 0;
  let cjk = 0;
  let latin = 0;
  let punctuation = 0;
  for (const character of value) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) {
      cjk += 1;
    } else if (/\p{Letter}|\p{Number}|\s/u.test(character)) {
      latin += 1;
    } else {
      punctuation += 1;
    }
  }
  return Math.max(Math.ceil(cjk + latin / 4 + punctuation / 2), 1);
}

function summarizeMessages(messages: AiChatMessageRow[], previousSummary?: string | null) {
  const lines = messages.map((message) => {
    const role = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";
    const compact = message.content.replace(/\s+/g, " ").trim();
    return `${role}: ${compact.slice(0, 480)}`;
  });
  const combined = [previousSummary?.trim(), ...lines].filter(Boolean).join("\n");
  if (combined.length <= summaryCharacterLimit) return combined;
  return combined.slice(combined.length - summaryCharacterLimit);
}

export function governAiChatContext(input: {
  messages: AiChatMessageRow[];
  systemPrompt?: string | null;
  previousSummary?: string | null;
  previouslyCompactedThroughMessageId?: number | null;
  contextWindow?: number | null;
  maxOutputTokens: number;
}) {
  const contextWindow = Math.max(input.contextWindow || 128000, 4096);
  const reserve = Math.min(Math.max(input.maxOutputTokens, 1024), Math.floor(contextWindow * 0.45));
  const safety = Math.max(Math.floor(contextWindow * 0.08), 1024);
  const budget = Math.max(contextWindow - reserve - safety, minimumContextBudget);
  const eligible = input.messages.filter(
    (message) =>
      message.status !== "failed" &&
      message.status !== "pending" &&
      message.status !== "streaming" &&
      message.status !== "superseded" &&
      Boolean(message.content.trim()),
  );
  const selected: AiChatMessageRow[] = [];
  let estimatedTokens = estimateAiTokens(input.systemPrompt || "") + estimateAiTokens(input.previousSummary || "");

  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const message = eligible[index];
    const tokens = estimateAiTokens(message.content) + 8;
    if (selected.length > 0 && estimatedTokens + tokens > budget) break;
    selected.unshift(message);
    estimatedTokens += tokens;
  }

  const selectedIds = new Set(selected.map((message) => message.id));
  const omitted = eligible.filter((message) => !selectedIds.has(message.id));
  const newlyOmitted = omitted.filter(
    (message) => message.id > (input.previouslyCompactedThroughMessageId ?? 0),
  );
  const summary = newlyOmitted.length
    ? summarizeMessages(newlyOmitted, input.previousSummary)
    : input.previousSummary?.trim() || null;
  const runtimeMessages: AiRuntimeMessage[] = [];
  if (input.systemPrompt?.trim()) {
    runtimeMessages.push({ role: "system", content: input.systemPrompt.trim() });
  }
  if (summary) {
    runtimeMessages.push({
      role: "system",
      content: `以下是较早对话的压缩摘要，仅用于保持上下文连续：\n${summary}`,
    });
  }
  runtimeMessages.push(
    ...selected.map((message) => ({ role: message.role, content: message.content } as AiRuntimeMessage)),
  );

  return {
    messages: runtimeMessages,
    summary,
    compactedThroughMessageId:
      omitted.at(-1)?.id ?? input.previouslyCompactedThroughMessageId ?? null,
    stats: {
      contextWindow,
      budget,
      estimatedTokens: runtimeMessages.reduce(
        (total, message) => total + estimateAiTokens(message.content) + 8,
        0,
      ),
      includedMessages: selected.length,
      compactedMessages: omitted.length,
      reservedOutputTokens: reserve,
    },
  };
}
