import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { registerDiscoveryTools } from './tools/discovery.js';
import { registerInspectTools } from './tools/inspect.js';
import { registerCompareTools } from './tools/compare.js';

function createServer() {
    const server = new McpServer({ name: 'github-discovery', version: '2.0.0' });

    registerDiscoveryTools(server); // search_github_repos, search_by_topic, get_trending_repos
    registerInspectTools(server); // get_repo_overview, get_repo_structure, get_file_content, get_recent_commits, list_branches
    registerCompareTools(server); // compare_repos

    return server;
}

void serveStdio(createServer);
console.error('GitHub Discovery MCP server running on stdio');
