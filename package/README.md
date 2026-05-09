# pi-zenmux

ZenMux provider extension for [Pi](https://github.com/mariozechner/pi-coding-agent). Auto-discovers and registers all available models from the [ZenMux](https://zenmux.ai) API gateway, with proper DeepSeek thinking-mode compat.

## Install

```bash
pi install npm:@neuron-mr-white/pi-zenmux
```

## Setup

Set your ZenMux API key:

```bash
export ZENMUX_API_KEY="sk-..."
```

## Usage

Start pi — ZenMux models appear under the `zenmux` provider:

```bash
pi
```

Select a model with `/model` or use `zenmux/<model-id>` directly:

```
/model zenmux/deepseek/deepseek-v4-pro
/model zenmux/openai/gpt-4o
```

## Commands

- `/zenmux-refresh` — Force refresh the model list from the ZenMux API

## Supported Models

All models available through the ZenMux gateway are automatically discovered. This includes:

- **DeepSeek** — v4-pro, v4-flash, v3.2, chat, reasoner, r1 (with proper thinking-mode compat)
- **OpenAI** — gpt-4o, gpt-4o-mini, o3-mini, o4-mini, etc.
- **Anthropic** — claude-sonnet-4-20250514, claude-opus-4-20250514, etc.
- **Google** — gemini-2.5-pro, gemini-2.5-flash, etc.
- **And more** — all models registered at [zenmux.ai](https://zenmux.ai)

## DeepSeek Thinking Mode

This extension registers DeepSeek models with the proper `compat` flags so Pi natively manages `reasoning_content` across multi-turn conversations with tool calls. No fetch-intercept hacks — Pi's built-in handling activates automatically.

## How It Works

1. **Startup**: Reads cached model list from `~/.cache/pi-zenmux/models.json` (24h TTL)
2. **Cache hit**: Registers models synchronously (zero latency)
3. **Cache miss**: Registers an empty provider, fetches models in the background, writes cache
4. **Model registration**: DeepSeek models get `compat.requiresReasoningContentOnAssistantMessages` and `thinkingFormat: "deepseek"` so Pi handles reasoning properly

## Development

Test locally without publishing:

```bash
ZENMUX_API_KEY="sk-..." pi -e ./extensions/index.ts
```

## License

MIT
