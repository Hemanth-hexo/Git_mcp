# GitHub Discovery MCP Server

An MCP server that helps Claude find relevant open-source GitHub repositories for research, learning, or a project you're building — and then dig into a specific repo's structure, code, history, and branches once you've found it worth a closer look.

> **Note on the live instance below:** `/mcp` now requires a token to use (see [Security](#security)). If you're the operator and haven't set `MCP_BEARER_TOKEN` in Render yet, follow the 3 steps in [Deploy as a shared connector](#deploy-as-a-shared-connector-a-url-instead-of-a-local-install) below before sharing `https://git-mcp-rvrp.onrender.com/mcp` with anyone — until then it may still be the older, unauthenticated version. It's free tier, so the first request after a few idle minutes can take 30-60 seconds to wake up — that's expected, just retry.

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

## Install & run

```bash
git clone https://github.com/Hemanth-hexo/Git_mcp.git
cd Git_mcp
npm install
```

Run it directly (it will sit waiting for a client on stdin/stdout — that's expected):

```bash
npm start
```

To try it interactively in a browser without wiring it into Claude Desktop yet, use the MCP Inspector:

```bash
npm run inspect
```

This opens a local web UI where you can call any of the tools by hand and see the raw result.

## Add to Claude Desktop

Edit Claude Desktop's config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add an entry under `mcpServers` (create the file/object if it doesn't exist), using the **absolute path** to `server.js` on your machine — run `pwd` inside the cloned folder to get it, then append `/server.js`. Setting `GITHUB_TOKEN` here too is strongly recommended once you use the inspection/comparison tools — see [Rate limits](#rate-limits):

```json
{
  "mcpServers": {
    "github-discovery": {
      "command": "node",
      "args": ["/absolute/path/to/Git_mcp/server.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

For example, if you cloned into your home directory, the path would look like `/Users/yourname/Git_mcp/server.js` (macOS/Linux) or `C:\\Users\\yourname\\Git_mcp\\server.js` (Windows). `GITHUB_TOKEN` is optional — omit the `env` block entirely to run without one.

Restart Claude Desktop. You should see "github-discovery" listed as a connected MCP server (check the 🔌/tools icon in the app), with all 9 tools available.

## Deploy as a shared connector (a URL instead of a local install)

Everything above runs the server as a local process only you can use. To share it with other people — friends, a class, a team — without them installing anything, deploy [server-http.js](server-http.js) instead: it's the same tools over Streamable HTTP, so anyone can add it in Claude as a **custom connector** by pasting a URL (works on claude.ai, Claude Desktop, Cowork, and mobile — see [Anthropic's docs](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)).

**Deploy to Render (free tier works for trying this with a few people):**

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. On [render.com](https://render.com), create a new **Web Service** and connect this GitHub repo.
3. Set the **Build Command** to `npm install` and the **Start Command** to `npm run start:http`. Leave the instance type on **Free** to start.
4. Deploy. Render assigns a URL like `https://your-app-name.onrender.com` — that's your connector URL, and MCP clients will connect to `https://your-app-name.onrender.com/mcp`.

**Then, before sharing that URL with anyone, set up the access token — 3 steps:**

**Step 1 — generate a secret.** Open Terminal and run:

```bash
openssl rand -hex 32
```

This prints a long random string. Copy it — you'll use it twice below. Treat it like a password: whoever has it can use every tool on your server.

**Step 2 — add it to Render.** In your service's dashboard:
- Click **Environment** in the left sidebar
- Click **+ Add Environment Variable**
- Key: `MCP_BEARER_TOKEN` → Value: paste the string from Step 1
- Click **Save Changes**, then choose **Save and deploy**

Without this step, `/mcp` rejects *every* request — including yours — rather than running open (see [Security](#security)). The service isn't usable until this is set.

While you're in the Environment tab, also add:
- `GITHUB_TOKEN` — a [personal access token](https://github.com/settings/tokens) (no scopes needed). With multiple people sharing one deployed instance, you'll burn through the unauthenticated rate limits (see below) much faster than solo local use.
- *(Optional)* `PUBLIC_HOST` — just the hostname (e.g. `your-app-name.onrender.com`, no `https://`). Locks the server to that hostname instead of accepting any `Host` header.

**Step 3 — connect (or reconnect) in Claude.** Settings → Connectors → Add custom connector → paste `https://your-app-name.onrender.com/mcp` → when it asks for authentication, paste the token from Step 1 → connect. If you already had this connector added from before the token existed, remove it first and re-add it. Share the URL *and* the token with anyone else who should have access.

*(One honest caveat: I haven't confirmed exactly what that "authentication" step looks like in Claude's UI for this kind of token — Claude's own docs describe custom connectors mainly in terms of OAuth Client ID/Secret, not a plain token field. If you don't see an obvious place to paste it, tell me what's on screen and we'll figure out the right field together.)*

**Worth knowing before you share the link widely:**

- Render's free tier spins the service down after 15 minutes of inactivity; the next request after that takes 30-60 seconds to wake it back up. See [server-http.js](server-http.js) for the health-check route at `/` if you want to point an uptime pinger at it — but for casual use among a few people, letting it sleep naturally is usually the better trade (see the free-tier rate limit math below).
- A shared static token works for a small trusted group. It is not per-user access control — anyone with the token has full access, and revoking access for one person means rotating the token for everyone. Real multi-user access (and charging) would need per-user credentials, which is a bigger step than this review covers.

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

| Bucket | Used by | Unauthenticated | With `GITHUB_TOKEN` |
|---|---|---|---|
| **search** | `search_github_repos`, `search_by_topic`, `get_trending_repos` | 10 requests/min | 30 requests/min |
| **core** | `get_repo_overview`, `get_repo_structure`, `get_file_content`, `get_recent_commits`, `list_branches`, `compare_repos` | 60 requests/**hour** | 5,000 requests/hour |

The search bucket is generous enough for casual interactive use. The core bucket is not — it resets hourly, not per-minute, and some tools spend more than one request per call (`get_repo_overview` makes up to 4, `compare_repos` makes 2 per repo compared). If you plan to use the inspection or comparison tools more than a few times an hour, set a token:

1. Create one at [github.com/settings/tokens](https://github.com/settings/tokens) (classic token, no scopes needed — this server only reads public data)
2. Add it as `GITHUB_TOKEN` — in the Claude Desktop config's `env` block (shown above) for local use, in Render's environment variables for a deployed instance, or exported in your shell before running `npm start`/`npm run inspect` locally

If a rate limit is hit, the server returns a clear message (instead of failing silently) telling you when it resets. This matters more once several people share one deployed instance — everyone's calls draw from the same 60/hour (or 5,000/hour with a token) core-limit bucket, since GitHub rate-limits by IP/token, not per-user.

## Security

This server underwent a security review focused on the HTTP deployment path. Current posture:

- **Input validation** — every tool argument is validated against a Zod schema before the handler runs; malformed input is rejected before it reaches any network call.
- **Authentication (HTTP transport only)** — `/mcp` requires `Authorization: Bearer <MCP_BEARER_TOKEN>`. The check **fails closed**: if `MCP_BEARER_TOKEN` isn't set, every request is rejected rather than the server falling back to open access (see [lib/auth.js](lib/auth.js)). Token comparison is constant-time to avoid leaking the secret through response-timing differences. `server.js` (stdio, for local/Claude Desktop use) is unaffected — a locally-spawned process is inherently scoped to whoever can run commands on that machine.
- **Untrusted content boundary** — README previews and file contents fetched from GitHub repos are wrapped in explicit `[UNTRUSTED CONTENT]` delimiters with an instruction not to treat them as commands, and the two tool descriptions that return this content say the same. This is a mitigation for indirect prompt injection (a malicious repo's README or source could otherwise contain text phrased as instructions to the model reading it) — framing, not content filtering; the underlying text is never altered or stripped.
- **SSRF-safe file downloads** — `get_file_content` follows GitHub's `download_url` for large files only if it resolves to `https://raw.githubusercontent.com`; any other host or scheme is refused rather than fetched (see `isAllowedDownloadUrl` in [lib/github.js](lib/github.js)).
- **No write access** — every GitHub API call this server makes is a read (`GET`). There is no code path that can create, modify, or delete anything on GitHub.
- **Error handling** — GitHub API errors return their normal (already-safe) user-facing text. Any *unexpected* exception is logged in full server-side and reduced to a generic message for the client — internal details (stack traces, file paths, dependency internals) are never returned in a tool result. Tokens are only ever placed in the `Authorization` request header, never logged, echoed in output, or embedded in a URL.

**Remaining risks / not covered by this review:**

- The bearer token is a single shared secret, not per-user auth — see the caveat above about how well this integrates with Claude's connector UI, which appears OAuth-oriented.
- No rate limiting or abuse protection beyond GitHub's own API limits — a valid token holder could still exhaust the shared `GITHUB_TOKEN`'s quota.
- No structured audit logging of who called what — see the note on observability in earlier project discussion; this review didn't add it.
- `PUBLIC_HOST` (Host-header validation) and `MCP_BEARER_TOKEN` are independent controls set separately in Render; deploying code changes alone does not retroactively secure an already-running instance until these env vars are actually set there.

## Project files

- [server.js](server.js) — local entry point; serves the tools over stdio (for Claude Desktop / the Inspector)
- [server-http.js](server-http.js) — deployable entry point; serves the same tools over Streamable HTTP (for a shared connector URL)
- [lib/createServer.js](lib/createServer.js) — the shared `McpServer` factory both entry points use
- [tools/discovery.js](tools/discovery.js) — `search_github_repos`, `search_by_topic`, `get_trending_repos`
- [tools/inspect.js](tools/inspect.js) — `get_repo_overview`, `get_repo_structure`, `get_file_content`, `get_recent_commits`, `list_branches`
- [tools/compare.js](tools/compare.js) — `compare_repos`
- [lib/github.js](lib/github.js) — shared GitHub API client, auth header injection, rate-limit/error handling, SSRF allowlist
- [lib/format.js](lib/format.js) — shared formatting helpers (relative dates, repo-ref parsing, truncation, untrusted-content wrapping)
- [lib/auth.js](lib/auth.js) — bearer-token auth gate for the HTTP transport (fail-closed)
- [test/](test) — unit and integration tests, run with `npm test` (Node's built-in test runner, no extra dependencies)
- [package.json](package.json) — dependencies (`@modelcontextprotocol/server`, `@modelcontextprotocol/express`, `@modelcontextprotocol/node`, `express`, `zod`)
