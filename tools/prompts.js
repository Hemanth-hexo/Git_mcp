import * as z from 'zod/v4';

// MCP "prompts" are the protocol's native shortcut mechanism — clients that
// support them (Claude Desktop, Claude Code, claude.ai) surface each one as
// a slash command (e.g. /gitty:getinfo). Invoking one just fills
// in a canned natural-language message using the given arguments; the model
// still picks which tool(s) to call from there. These don't add capability
// beyond the tools themselves — they exist purely to save typing for the
// handful of things people ask for most often.
export function registerPrompts(server) {
    server.registerPrompt(
        'getinfo',
        {
            title: 'Get repo info',
            description: 'Shortcut: get a full overview of a GitHub repo (stats, license, languages, latest release, README summary).',
            argsSchema: z.object({
                repo: z.string().describe("Repo as 'owner/name' or a GitHub URL, e.g. 'facebook/react'."),
            }),
        },
        ({ repo }) => ({
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: `Give me a full overview of the GitHub repo ${repo} — description, stars/forks/issues, license, languages, latest release, and a summary of its README.`,
                },
            }],
        })
    );

    server.registerPrompt(
        'getcodeinfo',
        {
            title: 'Get file/code info',
            description: 'Shortcut: read and explain one specific file in a GitHub repo.',
            argsSchema: z.object({
                repo: z.string().describe("Repo as 'owner/name' or a GitHub URL."),
                path: z.string().describe("File path inside the repo, e.g. 'src/index.js' or 'README.md'."),
            }),
        },
        ({ repo, path }) => ({
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: `Show me the contents of ${path} in the GitHub repo ${repo}, and explain what this code does.`,
                },
            }],
        })
    );

    server.registerPrompt(
        'findrepos',
        {
            title: 'Find repos',
            description: 'Shortcut: search GitHub for repos matching a topic or project description.',
            argsSchema: z.object({
                query: z.string().describe("What to search for, e.g. 'RAG implementations' or 'containerization examples'."),
            }),
        },
        ({ query }) => ({
            messages: [{
                role: 'user',
                content: { type: 'text', text: `Find me the best GitHub repos for: ${query}` },
            }],
        })
    );

    server.registerPrompt(
        'comparerepos',
        {
            title: 'Compare repos',
            description: 'Shortcut: compare 2-4 GitHub repos side by side.',
            argsSchema: z.object({
                repos: z.string().describe("2 to 4 repos separated by commas, e.g. 'facebook/react, vuejs/vue'."),
            }),
        },
        ({ repos }) => ({
            messages: [{
                role: 'user',
                content: { type: 'text', text: `Compare these GitHub repos side by side: ${repos}` },
            }],
        })
    );
}
