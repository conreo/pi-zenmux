# Changelog

## 1.0.3 (2026-05-09)

- **Fix: DeepSeek reasoning_content error through ZenMux gateway**  
  Pi's `openai-completions` provider auto-detects DeepSeek compat from URLs containing `deepseek.com`. Since ZenMux uses `zenmux.ai`, Pi never activated its native `reasoning_content` management for DeepSeek models. This caused `Error: 400 The reasoning_content in the thinking mode must be passed back to the API` when using thinking mode with tool calls.

  **Applied fix:** Explicit `compat` flags on DeepSeek non-reasoner models at registration:
  - `reasoning: true` — activates Pi's thinking pipeline
  - `compat.requiresReasoningContentOnAssistantMessages: true` — Pi caches and replays `reasoning_content` across multi-turn tool calls
  - `compat.thinkingFormat: "deepseek"` — uses DeepSeek's thinking API format
  - `thinkingLevelMap` — maps Pi's effort levels to DeepSeek's (`high`, `xhigh → max`)

  Pi now handles `reasoning_content` natively. Fetch interceptor simplified to only handle `developer → system` role rename (ZenMux compat).

- **Package metadata aligned with Pi conventions** (`author`, `repository`, `keywords: ["pi", "pi-extension"]`)

## 1.0.2 (2026-05-09)

- Initial public release
- Auto-discovers all ZenMux models with 24h caching
- `developer` → `system` role rename for ZenMux gateway compat
- `/zenmux-refresh` command for manual model list refresh
