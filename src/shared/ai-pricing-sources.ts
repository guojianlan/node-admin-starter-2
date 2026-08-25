export const aiProviderPricingSources: Record<string, { name: string; url: string } | undefined> = {
  openai: { name: "OpenAI API Pricing", url: "https://openai.com/api/pricing/" },
  anthropic: {
    name: "Anthropic Claude Pricing",
    url: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
  google: {
    name: "Google Gemini API Pricing",
    url: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  deepseek: {
    name: "DeepSeek API Pricing",
    url: "https://api-docs.deepseek.com/quick_start/pricing/",
  },
  qwen: {
    name: "Alibaba Cloud Model Studio Pricing",
    url: "https://help.aliyun.com/zh/model-studio/model-pricing",
  },
  moonshot: {
    name: "Kimi API Pricing",
    url: "https://platform.kimi.com/docs/pricing/chat",
  },
  zhipu: { name: "Zhipu AI Pricing", url: "https://open.bigmodel.cn/pricing" },
  siliconflow: { name: "SiliconFlow Pricing", url: "https://www.siliconflow.com/pricing" },
  openrouter: { name: "OpenRouter Models", url: "https://openrouter.ai/models" },
};

export function getOfficialAiPricingSource(providerType?: string | null) {
  return providerType ? aiProviderPricingSources[providerType] : undefined;
}
