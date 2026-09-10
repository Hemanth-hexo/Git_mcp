import { McpServer } from '@modelcontextprotocol/server';
import { registerDiscoveryTools } from '../tools/discovery.js';
import { registerInspectTools } from '../tools/inspect.js';
import { registerCompareTools } from '../tools/compare.js';
import { registerPrompts } from '../tools/prompts.js';

// Shared by both entry points: server.js (stdio, for local/Claude Desktop use)
// and server-http.js (Streamable HTTP, for a deployed/shared connector).
export function createServer() {
    const server = new McpServer({ name: 'github-discovery', version: '2.0.0' });

    registerDiscoveryTools(server); // search_github_repos, search_by_topic, get_trending_repos
    registerInspectTools(server); // get_repo_overview, get_repo_structure, get_file_content, get_recent_commits, list_branches
    registerCompareTools(server); // compare_repos
    registerPrompts(server); // getinfo, getcodeinfo, findrepos, comparerepos — slash-command shortcuts

    return server;
}
