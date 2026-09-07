# GitHub Discovery MCP Server

An MCP server that helps Claude find relevant open-source GitHub repositories for research, learning, or a project you're building. Describe what you're working on in plain language, and Claude uses this server to search GitHub and return the most relevant, well-maintained repos.

> **Phase 1 scope:** this server implements repo *discovery* (`search_github_repos`) only. Pointing Claude at a specific repo to inspect its structure, history, and files is a separate capability planned for a later phase and is not included here.

## What it does

One tool, `search_github_repos`:

- **Takes:** a description of what you're building/researching, plus optional filters (minimum stars, language, result count)
- **Returns:** the top matching repos, each with name, description, URL, stars, language, last-pushed date, and a short "why this is useful" snippet
- **Ranking:** results are re-ranked by a blend of stars and recent activity, so a popular but abandoned repo doesn't automatically outrank a smaller, actively maintained one

## Requirements

- Node.js 20 or later
- No GitHub account or API key required (uses GitHub's public REST API)

## Install & run

```bash
cd /Users/hemanthsarode/GIT_MCP
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

This opens a local web UI where you can call `search_github_repos` by hand and see the raw result.

## Add to Claude Desktop

Edit Claude Desktop's config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add an entry under `mcpServers` (create the file/object if it doesn't exist), using the absolute path to `server.js`:

```json
{
  "mcpServers": {
    "github-discovery": {
      "command": "node",
      "args": ["/Users/hemanthsarode/GIT_MCP/server.js"]
    }
  }
}
```

Restart Claude Desktop. You should see "github-discovery" listed as a connected MCP server (check the 🔌/tools icon in the app), with `search_github_repos` available as a tool.

## Example prompts

Once connected, just talk to Claude naturally:

- "Find me RAG implementation repos"
- "Show me containerization examples in Go"
- "I'm learning about vector databases — what are some good open-source projects to study?"
- "Find popular TypeScript repos for building agents, at least 500 stars"

## Rate limits

GitHub's search API allows **10 unauthenticated requests per minute**, which is plenty for interactive use. If you hit that limit (or want more headroom), set a personal access token — no special scopes are needed for public repo search:

1. Create a token at [github.com/settings/tokens](https://github.com/settings/tokens) (classic token, no scopes needed for public data)
2. Add it to the Claude Desktop config's `env` block:

```json
{
  "mcpServers": {
    "github-discovery": {
      "command": "node",
      "args": ["/Users/hemanthsarode/GIT_MCP/server.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

This raises the search limit to 30 requests/minute. If the server does hit a rate limit, it returns a clear error message (instead of failing silently) telling you when the limit resets.

## Project files

- [server.js](server.js) — the MCP server and `search_github_repos` tool
- [package.json](package.json) — dependencies (`@modelcontextprotocol/server`, `zod`)
