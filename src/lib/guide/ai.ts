/**
 * Optional "Ask Built2Bid" answers for the Guide. Off unless GUIDE_AI=on and the AI provider is
 * configured. Answers are grounded only in the verified help index (help.ts): the model is given the
 * matching walkthrough steps and must answer from them or say it doesn't know, and it never sees
 * customer, estimate or financial data. Help search works the same with this off.
 */
export const GUIDE_AI_MAX_QUESTION = 300;
export const GUIDE_AI_DAILY_LIMIT = 15;
/** Answers to the same question for the same plan/role reuse a cached reply for this long. */
export const GUIDE_AI_CACHE_MS = 6 * 3600_000;

export const isGuideAiEnabled = () => process.env.GUIDE_AI === "on" && Boolean(process.env.ANTHROPIC_API_KEY) && process.env.AI_TEXT_GENERATION !== "off";

export const GUIDE_AI_SYSTEM = [
  "You answer short how-to questions about Built2Bid, estimating software for contractors.",
  "Use only the HELP NOTES provided. If they don't answer the question, say you're not sure and suggest the Feature walkthrough or support@built2bid.org.",
  "Never invent buttons, pages, prices, plans or features. Never give legal, tax or financial advice.",
  "Answer in at most 3 short sentences of plain language, and name the page or button to use.",
].join(" ");
