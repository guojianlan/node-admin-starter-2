# AI Web Search

Admin Base implements Web Search as a server-owned Agent Tool. It is not a browser, arbitrary URL
fetcher, or model-native citation system.

## Configure A Provider

Open `/system/ai/web-search` and choose one of the built-in templates:

- Tavily: keep the default endpoint, enter a Tavily API key, save, test, then enable.
- Brave Search: keep the default endpoint, enter a Brave Search API key, save, test, then enable.
- SearXNG: enter the fixed SearXNG `/search` endpoint. API Key is optional when the deployment uses
  network-level access control.

`sort` is the connection priority. A lower value has higher priority. The highest-priority enabled
connection is the primary connection; timeout, provider errors, and empty results continue to the
next enabled connection in priority order. Ties are resolved by the lower record ID. There is no
separate default flag, so the primary connection and execution order cannot drift apart. Each saved
connection has its own timeout and result ceiling; the Tool also caps a request at 10 results.

The application exposes `web-search` to an Agent only while at least one Provider is enabled. The
Tool input is fixed:

```json
{ "query": "深圳今天的天气", "limit": 5 }
```

It cannot accept an endpoint, URL to fetch, Header, API key, method, body, SQL, file path, or shell
command. Search results and attempts are stored in the Agent Step. Chat sources are copied from the
server Tool result into Assistant message metadata and streamed in a separate `sources` event.

## Local SearXNG

Docker is optional for the application. It is useful for a repeatable local search integration:

```bash
docker compose -f deploy/local-integrations/searxng/compose.yml up -d
curl 'http://127.0.0.1:18082/search?q=Admin+Base&format=json'
```

The local Compose file defaults to the DaoCloud mirror because direct Docker Hub pulls can be
unreliable in some development networks. Override the image without editing the file when another
registry is preferred:

```bash
SEARXNG_IMAGE=searxng/searxng:latest \
  docker compose -f deploy/local-integrations/searxng/compose.yml up -d
```

The checked-in local profile keeps only the Baidu engine enabled. This avoids the timeout and
CAPTCHA failures commonly returned by the default public-engine set on local development networks.
An Internet-facing deployment should maintain its own SearXNG engine and proxy policy instead of
reusing this local profile.

Then edit the built-in `Local SearXNG` record:

```text
Endpoint: http://127.0.0.1:18082/search
API Key:  leave empty
Status:   enabled after the test succeeds
```

Stop and remove the local container after verification:

```bash
docker compose -f deploy/local-integrations/searxng/compose.yml down
```

The checked-in local `secret_key` is intentionally non-sensitive and must not be reused for an
Internet-facing SearXNG deployment.

## External Provider Acceptance

Real Tavily and Brave acceptance needs credentials supplied by the operator. Verify the saved
connection from the page, then use AI Chat with `通用工作助手` and ask a time-sensitive question.

For location-dependent questions such as current weather, the general assistant first requests the
system-owned `browser-location` Client Tool when the user did not provide a city. The browser asks
for one-time permission only after an explicit click, submits coarse coordinates, and resumes the
same Agent run before `web-search` is called. A denial, unsupported browser, or timeout resumes with
a request for the city instead of fabricating a location or failing the conversation.
Acceptance requires:

- A `web-search` Tool Step with normalized results and attempts.
- An Assistant answer followed by clickable server-derived sources.
- A `system.aiWebSearch.search` operation log sharing the Chat Request ID.
- No API key in API responses, Step output, operation logs, or browser network payloads.

Provider quotas, billing, regional availability, and source quality remain external service
boundaries. They are not simulated by unit tests.
