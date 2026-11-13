// Curated model suggestions for the Settings <datalist> (ADR-0003, QST-MODEL-PICKER = B).
// Users can still type ANY OpenRouter model ID; this list is only a shortcut.
// Every ID below was checked against the public GET /api/v1/models on 2026-11-12.
// Phase 3 replaces this with live suggestions from that endpoint (QST-MODEL-PICKER → C),
// keeping this list as the offline fallback.

export const SUGGESTED_MODELS = [
  { id: 'openrouter/free', label: 'Free Models Router (free, rate-limited)' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free, rate-limited)' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5' },
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5 (fast, low cost)' },
  { id: 'openai/gpt-6.1-terra', label: 'GPT-6.1 Terra' },
  { id: 'google/gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (low cost)' },
  { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick' },
  { id: 'openrouter/auto', label: 'Auto Router (paid; picks a model per prompt)' },
];
