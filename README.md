# GitHub Discovery MCP Server

[![Test](https://github.com/Hemanth-hexo/Git_mcp/actions/workflows/test.yml/badge.svg)](https://github.com/Hemanth-hexo/Git_mcp/actions/workflows/test.yml)

An MCP server that helps Claude find relevant open-source GitHub repositories for research, learning, or a project you're building — and then dig into a specific repo's structure, code, history, and branches once you've found it worth a closer look.

> **Try it now — genuinely public, no setup:** `https://git-mcp-rvrp.onrender.com/mcp` is live and open to anyone. In Claude, go to Settings → Connectors → Add custom connector, paste that URL, set Authentication to **None**, and connect — no token, no signup. It's free tier, so the first request after a few idle minutes can take 30-60 seconds to wake up — that's expected, just retry. See [Rate limits](#rate-limits) if you want higher limits than the shared free tier gives you.

## What it does

**Discovery** — find repos from a description or topic:

- `search_github_repos(query, filters)` — free-text search, ranked by a blend of stars and recent activity so an actively maintained project can beat a similarly popular but abandoned one
- `search_by_topic(topic, filters)` — search by GitHub's curated topic tags (e.g. `rag`, `llm-agent`) instead of free text
- `get_trending_repos(since, filters)` — repos created recently that are already gaining stars fast, as an approximation of "trending" (GitHub's API has no official trending endpoint)

**Inspection** — once you've picked a repo, look inside it:

- `get_repo_overview(repo)` — description, stars/forks/issues, license, topics, language breakdown, latest release, approx. contributor count, and a README preview
- `get_repo_structure(repo, path)` — browse the file tree one directory at a time
- `get_file_content(repo, path)` — read a specific file's contents
- `get_recent_commits(repo, branch, limit)` — recent commit history
- `list_branches(repo, limit)` — branches and what each currently points to

**Comparison** — deciding between a few candidates:

- `compare_repos(repos)` — 2-4 repos side by side as a table (stars, forks, issues, license, language, contributors, age, activity)

All the `repo` parameters above accept either `"owner/name"` or a full GitHub URL — you can paste the `full_name`/URL straight out of a search result.

## Requirements

- Node.js 20 or later
- No GitHub account or API key required for light use — see [Rate limits](#rate-limits) for when you'll want one

## Run it locally (optional)

Most people should just use the shared link above. Run it on your own machine instead only if you want to skip Render entirely — e.g. for development, or to avoid any shared rate limits.

```bash
git clone https://github.com/Hemanth-hexo/Git_mcp.git
cd Git_mcp
npm install
```

Add to Claude Desktop's config (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json`), using the absolute path to `server.js`:

```json
{
  "mcpServers": {
    "github-discovery": {
      "command": "node",
      "args": ["/absolute/path/to/Git_mcp/server.js"]
    }
  }
}
```

Restart Claude Desktop. No token needed here — this runs as a local process, not over the network, so the HTTP auth in [Security](#security) doesn't apply. Optionally add `GITHUB_TOKEN` in an `env` block to raise GitHub's rate limits (see [Rate limits](#rate-limits)). For quick manual testing without Claude Desktop at all, `npm run inspect` opens a local web UI to call tools by hand.

## Deploy as a shared connector (a URL instead of a local install)

Everything above runs the server as a local process only you can use. To make it available to anyone — friends, strangers, whoever — without them installing anything, deploy [server-http.js](server-http.js) instead: it's the same tools over Streamable HTTP, so anyone can add it in Claude as a **custom connector** by pasting a URL (works on claude.ai, Claude Desktop, Cowork, and mobile — see [Anthropic's docs](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)).

**Deploy to Render (free tier is fine to start):**

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. On [render.com](https://render.com), create a new **Web Service** and connect this GitHub repo.
3. Set the **Build Command** to `npm install` and the **Start Command** to `npm run start:http`. Leave the instance type on **Free** to start.
4. Deploy. Render assigns a URL like `https://your-app-name.onrender.com` — MCP clients connect to `https://your-app-name.onrender.com/mcp` (note the `/mcp`, the bare domain only serves a health-check page).

That's it — **no token setup required.** The server is public by design: anyone with the URL can use it immediately.

*(Optional)* In Render's Environment tab, you can still add:
- `PUBLIC_HOST` — just the hostname (e.g. `your-app-name.onrender.com`, no `https://`). Locks the server to that hostname instead of accepting any `Host` header — protects against DNS-rebinding-style tricks, not a login of any kind.
- `GITHUB_TOKEN` — a personal access token this server falls back to for anonymous callers who don't bring their own (see [Rate limits](#rate-limits)). Optional; the server works fine without it.

**Connect in Claude:** Settings → Connectors → Add custom connector → paste `https://your-app-name.onrender.com/mcp` → set **Authentication** to **None** (this server doesn't use OAuth or any login) → connect. Share the URL with anyone — that's the whole distribution step, nothing else to hand out.

**Worth knowing:**

- Render's free tier spins the service down after 15 minutes of inactivity; the next request after that takes 30-60 seconds to wake it back up.
- Because it's genuinely open, GitHub's own rate limits are the only thing standing between this and abuse — see [Rate limits](#rate-limits) for how that's handled and what its limits are.

## Example prompts

Once connected, just talk to Claude naturally:

- "Find me RAG implementation repos"
- "Show me containerization examples in Go"
- "What's trending in agent frameworks this week?"
- "Find repos tagged with vector-database"
- "Give me an overview of huggingface/transformers"
- "What's the file structure of that repo look like?"
- "Show me the recent commits on it"
- "Compare langchain, llamaindex, and haystack for me"

## Rate limits

GitHub's REST API has **two separate rate-limit buckets**, and this server's tools split across both:

| Bucket | Used by | Anonymous | With a token |
|---|---|---|---|
| **search** | `search_github_repos`, `search_by_topic`, `get_trending_repos` | 10 requests/min | 30 requests/min |
| **core** | `get_repo_overview`, `get_repo_structure`, `get_file_content`, `get_recent_commits`, `list_branches`, `compare_repos` | 60 requests/**hour** | 5,000 requests/hour |

The search bucket is generous enough for casual interactive use. The core bucket is not — it resets hourly, not per-minute, and some tools spend more than one request per call (`get_repo_overview` makes up to 4, `compare_repos` makes 2 per repo compared).

**How tokens work on the deployed connector (this is the key design point):** the server is public and takes no login, but it *does* read an optional `Authorization: Bearer <token>` header — and if you put your own [GitHub personal access token](https://github.com/settings/tokens) there (no scopes needed), your requests use *your own* rate limit, not a pool shared with every other stranger using the same link. Order of priority per request:

1. **Your own GitHub token**, if you sent one — you get your own 5,000/hour, unaffected by anyone else's usage.
2. The **operator's `GITHUB_TOKEN`** (if set on the server) — a shared fallback pool for anonymous callers.
3. Otherwise, **GitHub's fully anonymous limit** — the 60/hour (or 10/min search) figures above, shared across everyone not bringing their own token.

To use your own token when connecting in Claude: Add custom connector → Authentication: **None** → **Additional request headers** → Add header → name `Authorization`, value `Bearer <your GitHub token>`. Entirely optional — the server works with zero setup, this just gets you a bigger, un-shared quota.

**If you do bring your own token, two things worth knowing:**
- You're trusting *this server's operator* not to log or misuse it — verified in code and by test that it never is (see [Security](#security)), but that's a claim about this specific deployment, not a platform guarantee. Treat any third-party MCP connector's request for your token the same way you'd treat handing a password to a website you didn't build.
- Use a token scoped to **read-only, public-repo access only** (no `repo` write scope, no admin/org scopes) — this server only ever makes read requests, but a token with broader permissions than that is unnecessary risk if it were ever exposed, regardless of how this server itself behaves. If your token happens to have access to private repos, this server will read those too when asked — same as any GitHub API client using that token would.

**This server also has its own, separate rate limit** — 30 requests/minute per caller (by IP), regardless of GitHub tokens. This isn't about GitHub's API quota; it protects this server's own bandwidth/compute from being hammered directly (see [lib/rateLimit.js](lib/rateLimit.js)). Hitting it returns `429` with a `Retry-After` header and resets a minute later — normal interactive use won't come close to it.

Running locally (`server.js`/stdio), the same priority applies except there's no per-request header to bring — set `GITHUB_TOKEN` in the Claude Desktop config's `env` block (or your shell) to raise your own limit.

If a rate limit is hit, the server returns a clear message (instead of failing silently) telling you when it resets and reminding you that bringing your own token is an option.

## Security

This server underwent a security review, then a deliberate follow-up change: it moved from a single shared access token to fully public access with optional per-caller GitHub tokens (see [Rate limits](#rate-limits)). Current posture:

- **Input validation** — every tool argument is validated against a Zod schema before the handler runs; malformed input is rejected before it reaches any network call.
- **Public by design (HTTP transport)** — `/mcp` takes no login and rejects nothing based on identity. It optionally reads an `Authorization: Bearer <token>` header and, when present, uses that value as *that caller's own* GitHub token for GitHub API calls made on their behalf — see [lib/auth.js](lib/auth.js) and `createGitHubClient` in [lib/github.js](lib/github.js). A caller's token is used only for their own request and never stored, logged, or reused for anyone else (verified by test — see `test/githubClient.test.js`'s "no cross-caller leakage" case). `server.js` (stdio, for local/Claude Desktop use) is a separate, locally-spawned process, inherently scoped to whoever can run commands on that machine.
- **Untrusted content boundary** — README previews and file contents fetched from GitHub repos are wrapped in explicit `[UNTRUSTED CONTENT]` delimiters with an instruction not to treat them as commands, and the two tool descriptions that return this content say the same. This is a mitigation for indirect prompt injection (a malicious repo's README or source could otherwise contain text phrased as instructions to the model reading it) — framing, not content filtering; the underlying text is never altered or stripped.
- **SSRF-safe file downloads** — `get_file_content` follows GitHub's `download_url` for large files only if it resolves to `https://raw.githubusercontent.com`; any other host or scheme is refused rather than fetched (see `isAllowedDownloadUrl` in [lib/github.js](lib/github.js)).
- **No write access** — every GitHub API call this server makes is a read (`GET`). There is no code path that can create, modify, or delete anything on GitHub — including with a caller-supplied token, which is only ever attached to the same read-only calls every other request makes.
- **Error handling** — GitHub API errors return their normal (already-safe) user-facing text. Any *unexpected* exception is logged in full server-side and reduced to a generic message for the client — internal details (stack traces, file paths, dependency internals) are never returned in a tool result. No token (a caller's own or the operator's `GITHUB_TOKEN`) is ever logged, echoed in output, or embedded in a URL.
- **Caller-token forwarding was verified, not assumed** — since accepting an arbitrary caller-supplied credential and attaching it to outbound requests is the one genuinely new attack surface this change introduces, it was tested directly: an attempted header-injection payload (embedded CR/LF in the token) is rejected by Node's own `fetch` with a clean `TypeError` before any request leaves the server, caught by the existing error handling with no crash. A caller's token is confirmed (by code inspection and by `test/githubClient.test.js`) to reach only `createGitHubClient` — it's never interpolated into a log line, error message, or response text.
- **Per-caller rate limiting on this server itself** — 30 requests/minute per IP, independent of GitHub's own limits; see [Rate limits](#rate-limits) and [lib/rateLimit.js](lib/rateLimit.js). Protects the server's own bandwidth/compute from being hammered directly, which GitHub's API limits alone don't cover (they only throttle GitHub calls, not requests that never get that far).
- **Basic request logging** — every `/mcp` request logs its timestamp, caller IP, JSON-RPC method, and tool name (for `tools/call`) to stderr (visible in Render's Logs tab). Deliberately excludes tool arguments, query text, and tokens — see [lib/requestLog.js](lib/requestLog.js) and its tests for what is and isn't logged.
- **CI** — every push to `main` and every pull request runs the full test suite via GitHub Actions ([.github/workflows/test.yml](.github/workflows/test.yml)); the badge at the top of this README reflects the current status.

**Remaining risks / not covered here:**

- Rate limiting is per-IP, not per-identity — there's no login, so a caller behind a shared/rotating IP (or simply willing to rotate IPs) isn't meaningfully throttled by this alone. It stops accidental or unsophisticated hammering, not a determined attacker.
- Logging is basic (stderr text, 7-day retention on Render's free tier) — there's no persistent store, dashboard, or alerting on top of it; someone has to go look at the logs.
- `PUBLIC_HOST` (Host-header validation) is still available and recommended, but it only restricts *which hostname* the server answers on the network layer — it has nothing to do with who's allowed to use the tools, since there's no identity concept here at all.

## Project files

- [server.js](server.js) — local entry point; serves the tools over stdio (for Claude Desktop / the Inspector)
- [server-http.js](server-http.js) — deployable entry point; serves the same tools over Streamable HTTP (for a shared connector URL)
- [lib/createServer.js](lib/createServer.js) — the shared `McpServer` factory both entry points use
- [tools/discovery.js](tools/discovery.js) — `search_github_repos`, `search_by_topic`, `get_trending_repos`
- [tools/inspect.js](tools/inspect.js) — `get_repo_overview`, `get_repo_structure`, `get_file_content`, `get_recent_commits`, `list_branches`
- [tools/compare.js](tools/compare.js) — `compare_repos`
- [lib/github.js](lib/github.js) — shared GitHub API client, per-caller token priority (`createGitHubClient`), rate-limit/error handling, SSRF allowlist
- [lib/format.js](lib/format.js) — shared formatting helpers (relative dates, repo-ref parsing, truncation, untrusted-content wrapping)
- [lib/auth.js](lib/auth.js) — extracts an optional caller-supplied GitHub token from the Authorization header; never blocks a request
- [lib/rateLimit.js](lib/rateLimit.js) — per-IP request rate limiting for the HTTP transport (protects this server, independent of GitHub's own limits)
- [lib/requestLog.js](lib/requestLog.js) — minimal per-request logging (method, tool name, caller IP) with no arguments/tokens ever logged
- [test/](test) — unit and integration tests, run with `npm test` (Node's built-in test runner, no extra dependencies)
- [.github/workflows/test.yml](.github/workflows/test.yml) — CI: runs the test suite on every push to `main` and every pull request
- [package.json](package.json) — dependencies (`@modelcontextprotocol/server`, `@modelcontextprotocol/express`, `@modelcontextprotocol/node`, `express`, `zod`)
