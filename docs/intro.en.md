# dsh-memory-rag

Local RAG memory for DeepSeek Harness: memories live in a local vector store and are retrieved on demand, instead of being pasted into the system prompt.

- **Five tools**: `rag_search` (retrieve), `rag_remember` (store one fact), `rag_ingest` (import md/mdx/txt files or directories), `rag_forget` (delete), `rag_stats` (status).
- **Three modes**: cloud OpenAI-compatible embeddings (Qwen, SiliconFlow, OpenAI, custom), local Ollama, and a fully offline BM25 keyword mode — no key, no network, no model download.
- **Session index injection**: a small locally rendered index (pinned notes, recent project notes, file groups) is added at session start, with zero network calls and a stable prefix across turns.
- **Settings page**: switch provider, store the API key (write-only), choose model and dimensions, tune retrieval, test the connection, browse memories.
- **Sidebar "Memory insights"**: KPIs, daily additions, composition, tags, storage and a 56-day activity heatmap.

After installing, open **Settings → RAG Memory**: pick the local keyword (BM25) provider for zero configuration, or choose a provider and paste a key for semantic search. Restart the DSH desktop app once and reload the page.

Everything stays local under `<DSH_HOME>/memories/dsh-rag-memory/`; only text you explicitly remember or ingest is sent to the embedding endpoint you configure.
