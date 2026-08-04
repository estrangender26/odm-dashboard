# Ollama AI Provider Configuration

This document covers the Ollama-based conversational AI integration used by the ODM Dashboard assistant.

## Overview

The dashboard's conversational AI is backed by an Ollama endpoint using the OpenAI-compatible `/v1/chat/completions` API. Deterministic dashboard analysis engines (`api/universal-ai.ts`, `api/governance-ai.ts`) remain the source of truth for all calculations; Kimi (or any configured model) only summarizes or explains the evidence supplied by those engines.

## Required Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `AI_PROVIDER` | No | `ollama` | Provider identifier. Currently only `ollama` is supported. |
| `OLLAMA_BASE_URL` | Yes | — | Root URL of the Ollama endpoint, e.g. `http://localhost:11434`. |
| `OLLAMA_API_KEY` | No | — | Optional bearer token for endpoints that require authentication. |
| `OLLAMA_MODEL` | No | `kimi-k2.7-code:cloud` | Model name passed to `/v1/chat/completions`. |
| `OLLAMA_TIMEOUT_MS` | No | `120000` | Request timeout in milliseconds. |
| `OLLAMA_MAX_TOKENS` | No | `1500` | Maximum tokens per response. |

Base URLs are normalized automatically so trailing slashes do not create malformed URLs.

## Local Development

1. Install and run Ollama locally: https://ollama.com
2. Pull the model if it is not already present:
   ```bash
   ollama pull kimi-k2.7-code:cloud
   ```
3. Ensure Ollama is listening (default `http://localhost:11434`).
4. Set in your local `.env`:
   ```env
   OLLAMA_BASE_URL=http://localhost:11434
   ```
5. Start the dashboard (`npm run dev`) and open the AI assistant.

## Production / Render

Render (and any other cloud host) **cannot** reach `localhost:11434` on a developer's machine. Production requires a server-reachable Ollama endpoint such as:

- A dedicated Ollama host with a public or private URL.
- An Ollama-compatible cloud service that exposes an OpenAI-compatible chat-completions endpoint.
- A sidecar or internal service reachable from the Render web service.

Configure Render environment variables through the Render dashboard:

```env
OLLAMA_BASE_URL=https://your-ollama-host.example.com
OLLAMA_API_KEY=your-optional-key
OLLAMA_MODEL=kimi-k2.7-code:cloud
OLLAMA_TIMEOUT_MS=120000
OLLAMA_MAX_TOKENS=1500
```

Do **not** commit real URLs, keys, or secrets to version control. The `.env.example` file contains placeholders only.

## Changing the Model Without Editing Code

Set `OLLAMA_MODEL` to any model your Ollama endpoint supports. If the variable is omitted, the default `kimi-k2.7-code:cloud` is used. No source-code change is required.

## Smoke Test

After configuring `OLLAMA_BASE_URL`:

```bash
# Passive configuration check (no network call)
curl "http://localhost:3000/api/trpc/ai.status"

# Active bounded health check
# (probes /api/tags, does not perform a full inference)
curl "http://localhost:3000/api/trpc/ai.health"
```

A successful chat test:

```bash
curl -X POST "http://localhost:3000/api/trpc/ai.maintenanceChat" \
  -H "Content-Type: application/json" \
  -d '{"json":{"message":"What is cavitation?"}}'
```

## Security Notes

- `OLLAMA_API_KEY` is read server-side only and never sent to the browser.
- Public status and error responses do not include the API key, endpoint URL, Authorization header, or environment-variable inventories.
- Health checks use a short timeout and a lightweight `/api/tags` probe.

## Rollback Procedure

1. In Render, revert `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`, and `OLLAMA_MODEL` to the previous values (or unset them).
2. If the previous provider was Groq, restore `GROQ_API_KEY` and `GROQ_MODEL` and revert the code changes on `main` by reverting the PR commit.
3. Re-deploy the previous commit; do not merge the rollback branch unless you intend to keep it.

## Files Changed

- `api/ollama-client.ts` — new Ollama client.
- `api/ai-router.ts` — uses Ollama for conversational AI; passive status endpoint; bounded health endpoint.
- `src/components/AIAssistant.tsx` — provider-neutral setup guidance.
- `public/ai-assistant.js`, `public/governance.html`, `public/mw-dashboard.html` — neutral AI labels.
- `.env.example` — Ollama placeholders.
- `api/ollama-client.test.ts`, `api/ai-router-ollama.test.ts` — Ollama behavior tests (all external calls mocked).
