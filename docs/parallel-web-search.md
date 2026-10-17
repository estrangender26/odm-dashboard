# Parallel web search for the AI assistant

The dashboard can use [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
for current web evidence, such as recent pump-maintenance guidance or water-utility
news. Select it explicitly in the server environment:

```env
WEB_SEARCH_PROVIDER=parallel
```

No account or API key is needed. The anonymous endpoint uses Fast mode and has
free-tier usage limits. This adapter uses only the `web_search` tool, over
Streamable HTTP at `https://search.parallel.ai/mcp`. It does not implement page
fetching or authenticated Parallel access.

After installing dependencies with `npm ci`, configure the conversational model
using [Ollama AI Provider Configuration](./ollama-ai-provider.md), then start the
dashboard with `npm run dev`. Open the AI assistant and ask a current-information
question such as “What is the latest guidance on pump maintenance?” Search
excerpts enter the existing answer-synthesis path as untrusted evidence; answers
retain the existing source-title and domain formatting. Search configuration alone
does not configure the conversational model.

The provider times out after 15 seconds, closes its MCP connection after each
search, and uses the existing search-failure response when live evidence cannot
be retrieved. Rate limits and service errors do not trigger another provider or
silently use a stored API key. Only the search question is sent to Parallel; the
adapter does not send the dashboard context payload. Avoid including confidential
information in questions sent to external search providers.

Tavily remains the default when `WEB_SEARCH_PROVIDER` is unset or unrecognized.
Existing `tavily`, `serper`, and `brave` selections and their key configuration
continue to work. `WEB_SEARCH_API_KEY` and other providers' keys are ignored when
Parallel is selected. To return to a previous provider, restore its
`WEB_SEARCH_PROVIDER` value and existing key; to leave search unconfigured, unset
the provider and search keys.

The proposed technology decision is recorded in
[ADR-0002](./adr/ADR-0002.md).
