# GitHub Discovery MCP Server

An MCP server that helps Claude find relevant open-source GitHub repositories for research, learning, or a project you're building — and then dig into a specific repo's structure, code, history, and branches once you've found it worth a closer look.

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
2. Add it as `GITHUB_TOKEN` in the Claude Desktop config's `env` block (shown above), or export it in your shell before running `npm start`/`npm run inspect` locally

If a rate limit is hit, the server returns a clear message (instead of failing silently) telling you when it resets.

## Project files

- [server.js](server.js) — entry point; wires up the MCP server and registers all tool groups
- [tools/discovery.js](tools/discovery.js) — `search_github_repos`, `search_by_topic`, `get_trending_repos`
- [tools/inspect.js](tools/inspect.js) — `get_repo_overview`, `get_repo_structure`, `get_file_content`, `get_recent_commits`, `list_branches`
- [tools/compare.js](tools/compare.js) — `compare_repos`
- [lib/github.js](lib/github.js) — shared GitHub API client, auth header injection, rate-limit/error handling
- [lib/format.js](lib/format.js) — shared formatting helpers (relative dates, repo-ref parsing, truncation)
- [package.json](package.json) — dependencies (`@modelcontextprotocol/server`, `zod`)
