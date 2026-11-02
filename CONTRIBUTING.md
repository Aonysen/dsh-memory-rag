# Contributing

Thanks for taking a look. This plugin is intentionally small and dependency-free
(no build step, no `node_modules` in the published package), so changes stay easy
to review.

## Development

Requirements: Node.js >= 20 (Node 22/24 tested), any OS.

```bash
git clone https://github.com/aonysen/dsh-memory-rag.git
cd dsh-memory-rag
node --test          # 94 offline unit tests, no network needed
```

Optional live smoke test (needs an API key in `<dataDir>/api-key` or env):

```bash
node scripts/smoke-embed.mjs
```

## Layout

| Path | Purpose |
|---|---|
| `index.js` | plugin entry (`apply(ctx, config)`, registrations) |
| `lib/config.js` | defaults, provider presets, key resolution, legacy migration |
| `lib/settings.js` | editable settings persistence and patches |
| `lib/api.js` | host HTTP API for the settings and insights pages |
| `lib/status.js` / `lib/dashboard.js` | runtime snapshot and insights data |
| `lib/embedder.js` | OpenAI-compatible embeddings client |
| `lib/chunk.js`, `lib/store.js`, `lib/search.js`, `lib/bm25.js` | chunking, storage, retrieval |
| `lib/tools.js` | the five agent tools |
| `lib/inject.js` | system-prompt rules section and session index |
| `client.js` | hand-written browser module (settings page + insights panel) |

## Pull requests

- Run `node --test` before pushing; CI runs it on Windows and Ubuntu with Node 22/24.
- Keep the package dependency-free and build-free. If a feature truly needs a
  dependency, open an issue first.
- User-facing text is bilingual: update both `locale/zh.json` and `locale/en.json`,
  and the `STRINGS.zh` / `STRINGS.en` dictionaries in `client.js`.
- Never log, echo or persist secrets; the settings API must keep returning only
  "configured / not configured" and the key source.
- Update `CHANGELOG.md` under an "Unreleased" heading for behavioural changes.
- Do not edit generated files; everything here is source.

## Reporting bugs

Open an issue with the template. Please include the DSH version, the plugin
version, the provider (`qwen-cn`, `ollama`, `keyword`, …) and, when relevant,
the error text from the settings page or `rag_stats`.
