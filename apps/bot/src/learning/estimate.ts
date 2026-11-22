/** Per-million-token prices seen for DeepSeek V4.1 Flash behind OpenRouter. */
export const PRICE_RANGE = {
  low: { input: 0.05, output: 0.2 },
  high: { input: 0.3, output: 1.2 },
};

const CHARS_PER_TOKEN = 3.5;
const MESSAGES_PER_BATCH = 100;
const PROMPT_TOKENS_PER_BATCH = 3_000;
const OUTPUT_TOKENS_PER_BATCH = 1_500;
const SUMMARY_TOKENS = { input: 1_200, output: 300 };

export interface CostEstimate {
  batches: number;
  inputTokens: number;
  outputTokens: number;
  lowUsd: number;
  highUsd: number;
}

/** Rough cost of analysing `messages` messages totalling `chars` characters, by `members` people. */
export function estimateAnalysisCost(messages: number, chars: number, members: number): CostEstimate {
  const batches = Math.ceil(messages / MESSAGES_PER_BATCH);
  const inputTokens = Math.ceil(chars / CHARS_PER_TOKEN) + batches * PROMPT_TOKENS_PER_BATCH + members * SUMMARY_TOKENS.input;
  const outputTokens = batches * OUTPUT_TOKENS_PER_BATCH + members * SUMMARY_TOKENS.output;
  const cost = (price: { input: number; output: number }) => (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return { batches, inputTokens, outputTokens, lowUsd: cost(PRICE_RANGE.low), highUsd: cost(PRICE_RANGE.high) };
}
