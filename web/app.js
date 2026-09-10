'use strict';

// Point this at your deployed API. Defaults to the live Render instance;
// override with ?api=http://localhost:3000/api while developing locally.
const DEFAULT_API_BASE = 'https://git-mcp-rvrp.onrender.com/api';
const API_BASE = new URLSearchParams(location.search).get('api') || DEFAULT_API_BASE;

const TOKEN_KEY = 'gh_discovery_token';
const AI_KEY_KEY = 'gh_discovery_ai_key';
const AI_PROVIDER_KEY = 'gh_discovery_ai_provider';

// Renders markdown to HTML and strips anything dangerous before it's ever
// set as innerHTML - README content comes from arbitrary public repos, so
// it must be treated as untrusted (a malicious repo's README can otherwise
// embed <script> or event-handler attributes). marked() does not sanitize
// on its own; DOMPurify is what makes this safe to render at all.
function renderMarkdown(text) {
    const html = marked.parse(String(text ?? ''));
    return DOMPurify.sanitize(html);
}

// ---------- tiny utilities ----------

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Builds a #/repo/... hash for a given "owner/name" full name. Encoding
// owner and name SEPARATELY (not the whole "owner/name" string at once) is
// the point: encodeURIComponent escapes "/" to "%2F", so encoding the pair
// together collapses them into one path segment and the router's two-segment
// route (owner, then name) never matches.
function repoPath(fullName, tab, query) {
    const slash = fullName.indexOf('/');
    const owner = fullName.slice(0, slash);
    const name = fullName.slice(slash + 1);
    let hash = `#/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    if (tab) hash += `/${tab}`;
    if (query) hash += `?${query}`;
    return hash;
}

// Accepts "owner/repo" or a full GitHub URL and returns "owner/repo", or
// null if it can't parse one — used by the "jump to a specific repo" box so
// people can paste in their own project's URL directly, not just search.
function parseRepoInput(input) {
    let s = String(input || '').trim();
    const urlMatch = s.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i);
    if (urlMatch) s = `${urlMatch[1]}/${urlMatch[2]}`;
    s = s.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    const parts = s.split('/').filter(Boolean);
    return parts.length === 2 ? `${parts[0]}/${parts[1]}` : null;
}

function formatCount(n) {
    if (n == null) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
}

function relativeTime(dateStr) {
    if (!dateStr) return 'unknown';
    const days = (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
    if (days < 1) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 30) return `${Math.floor(days)} days ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
}

const LANG_COLORS = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Go: '#00ADD8', Rust: '#dea584',
    Java: '#b07219', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600', Ruby: '#701516', PHP: '#4F5D95',
    Shell: '#89e051', HTML: '#e34c26', CSS: '#563d7c', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB',
};
function langColor(lang) {
    return LANG_COLORS[lang] || '#8d96a0';
}

function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

function getToken() {
    try {
        return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
        return '';
    }
}

function getAiSettings() {
    try {
        return { apiKey: localStorage.getItem(AI_KEY_KEY) || '', provider: localStorage.getItem(AI_PROVIDER_KEY) || 'gemini' };
    } catch {
        return { apiKey: '', provider: 'gemini' };
    }
}

// ---------- API client ----------

async function apiRequest(path, { method = 'GET', body, extraHeaders } = {}) {
    const headers = { ...extraHeaders };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';

    let res;
    try {
        res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
        throw new Error('Could not reach the API. If it just woke up from sleep, wait a few seconds and try again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
}

const api = {
    search: (params) => apiRequest(`/search?${new URLSearchParams(params)}`),
    searchByTopic: (params) => apiRequest(`/search/topic?${new URLSearchParams(params)}`),
    trending: (params) => apiRequest(`/trending?${new URLSearchParams(params)}`),
    repoOverview: (owner, name) => apiRequest(`/repos/${owner}/${name}`),
    repoStructure: (owner, name, path) => apiRequest(`/repos/${owner}/${name}/structure?${new URLSearchParams({ path: path || '' })}`),
    repoFile: (owner, name, path) => apiRequest(`/repos/${owner}/${name}/file?${new URLSearchParams({ path })}`),
    repoCommits: (owner, name) => apiRequest(`/repos/${owner}/${name}/commits`),
    repoBranches: (owner, name) => apiRequest(`/repos/${owner}/${name}/branches`),
    compare: (repos) => apiRequest('/compare', { method: 'POST', body: { repos } }),
    explain: (owner, name) => {
        const { apiKey, provider } = getAiSettings();
        const extraHeaders = apiKey ? { 'X-AI-Key': apiKey, 'X-AI-Provider': provider } : undefined;
        return apiRequest(`/repos/${owner}/${name}/explain`, { method: 'POST', extraHeaders });
    },
};

// ---------- shared render fragments ----------

function repoCardHtml(repo) {
    const topics = (repo.topics || []).slice(0, 5)
        .map((t) => `<span class="topic-pill">${escapeHtml(t)}</span>`).join('');
    return `
        <div class="repo-card">
            <h3><a href="${repoPath(repo.fullName)}">${escapeHtml(repo.fullName)}</a>${repo.archived ? '<span class="badge">ARCHIVED</span>' : ''}</h3>
            ${repo.description ? `<p class="desc">${escapeHtml(repo.description)}</p>` : ''}
            <div class="repo-meta">
                ${repo.language ? `<span><span class="lang-dot" style="background:${langColor(repo.language)}"></span>${escapeHtml(repo.language)}</span>` : ''}
                <span>★ ${formatCount(repo.stars)}</span>
                <span>⑂ ${formatCount(repo.forks)}</span>
                <span>Updated ${relativeTime(repo.pushedAt)}</span>
            </div>
            ${topics ? `<div class="topics">${topics}</div>` : ''}
        </div>`;
}

function loadingHtml(label = 'Loading…') {
    return `<div class="state-message"><div class="spinner"></div>${escapeHtml(label)}</div>`;
}

function errorHtml(message) {
    return `<div class="state-message error">${escapeHtml(message)}</div>`;
}

// ---------- views ----------

const app = document.getElementById('app');

function setActiveNav(name) {
    document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

async function renderSearchView(query) {
    setActiveNav('search');
    app.innerHTML = `
        <form id="search-form" class="filters">
            <input type="search" id="q" placeholder="What are you building or researching?" value="${escapeHtml(query || '')}" />
            <input type="text" id="language" placeholder="Language (optional)" />
            <input type="number" id="minStars" placeholder="Min stars" min="0" />
            <button class="btn btn-primary" type="submit">Search</button>
        </form>
        <form id="repo-jump-form" class="filters repo-jump">
            <span class="muted small">Or look up a specific repo (yours included):</span>
            <input type="text" id="repo-jump-input" placeholder="owner/repo or a GitHub URL" />
            <button class="btn" type="submit">Open</button>
        </form>
        <div id="jump-error"></div>
        <div id="results"></div>`;

    document.getElementById('search-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const q = document.getElementById('q').value.trim();
        if (!q) return;
        location.hash = `#/?q=${encodeURIComponent(q)}`;
    });

    document.getElementById('repo-jump-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const raw = document.getElementById('repo-jump-input').value;
        const parsed = parseRepoInput(raw);
        const errorBox = document.getElementById('jump-error');
        if (!parsed) {
            errorBox.innerHTML = `<p class="muted small" style="color:var(--danger)">Couldn't parse "${escapeHtml(raw)}" — use "owner/repo" or a full GitHub URL.</p>`;
            return;
        }
        errorBox.innerHTML = '';
        location.hash = repoPath(parsed);
    });

    if (!query) {
        document.getElementById('results').innerHTML = `<div class="state-message">Search for a technology, topic, or project idea above to get started.</div>`;
        return;
    }

    const results = document.getElementById('results');
    results.innerHTML = loadingHtml('Searching GitHub…');
    try {
        const language = document.getElementById('language').value.trim();
        const minStars = document.getElementById('minStars').value;
        const data = await api.search({ q: query, ...(language && { language }), ...(minStars && { minStars }), limit: 20 });
        if (data.repos.length === 0) {
            results.innerHTML = `<div class="state-message">No repos found for "${escapeHtml(query)}". Try broadening the search.</div>`;
            return;
        }
        results.innerHTML = `
            <div class="result-count">${formatCount(data.totalCount)} total matches — showing top ${data.repos.length}</div>
            <div class="repo-list">${data.repos.map(repoCardHtml).join('')}</div>`;
    } catch (err) {
        results.innerHTML = errorHtml(err.message);
    }
}

async function renderTrendingView() {
    setActiveNav('trending');
    app.innerHTML = `
        <div class="filters">
            <select id="since">
                <option value="daily">Today</option>
                <option value="weekly" selected>This week</option>
                <option value="monthly">This month</option>
            </select>
        </div>
        <div id="results">${loadingHtml('Finding what’s trending…')}</div>`;

    async function load() {
        const results = document.getElementById('results');
        results.innerHTML = loadingHtml();
        try {
            const since = document.getElementById('since').value;
            const data = await api.trending({ since, limit: 20 });
            if (data.repos.length === 0) {
                results.innerHTML = `<div class="state-message">Nothing new in that window yet. Try a wider one.</div>`;
                return;
            }
            results.innerHTML = `
                <div class="result-count">New repos created in the last ${data.windowDays} day(s), ranked by stars so far</div>
                <div class="repo-list">${data.repos.map(repoCardHtml).join('')}</div>`;
        } catch (err) {
            results.innerHTML = errorHtml(err.message);
        }
    }
    document.getElementById('since').addEventListener('change', load);
    load();
}

async function renderCompareView(reposParam) {
    setActiveNav('compare');
    const initial = (reposParam || '').split(',').map((s) => s.trim()).filter(Boolean);
    app.innerHTML = `
        <form id="compare-form" class="compare-input">
            <input type="text" id="c1" placeholder="owner/repo" value="${escapeHtml(initial[0] || '')}" />
            <input type="text" id="c2" placeholder="owner/repo" value="${escapeHtml(initial[1] || '')}" />
            <input type="text" id="c3" placeholder="owner/repo (optional)" value="${escapeHtml(initial[2] || '')}" />
            <input type="text" id="c4" placeholder="owner/repo (optional)" value="${escapeHtml(initial[3] || '')}" />
            <button class="btn btn-primary" type="submit">Compare</button>
        </form>
        <div id="results"></div>`;

    document.getElementById('compare-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const repos = ['c1', 'c2', 'c3', 'c4'].map((id) => document.getElementById(id).value.trim()).filter(Boolean);
        location.hash = `#/compare/${encodeURIComponent(repos.join(','))}`;
    });

    if (initial.length < 2) {
        document.getElementById('results').innerHTML = `<div class="state-message">Enter 2 to 4 repos to compare.</div>`;
        return;
    }

    const results = document.getElementById('results');
    results.innerHTML = loadingHtml('Fetching repos…');
    try {
        const data = await api.compare(initial);
        if (data.repos.length < 2) {
            results.innerHTML = errorHtml('Not enough valid repos to compare.' + (data.failed.length ? ' ' + data.failed.map((f) => `${f.input}: ${f.error}`).join('; ') : ''));
            return;
        }
        const rows = data.repos.map((r) => `
            <tr>
                <td><a href="${repoPath(r.fullName)}">${escapeHtml(r.fullName)}</a></td>
                <td>${formatCount(r.stars)}</td>
                <td>${formatCount(r.forks)}</td>
                <td>${formatCount(r.openIssues)}</td>
                <td>${escapeHtml(r.language || '—')}</td>
                <td>${escapeHtml(r.license || 'None')}</td>
                <td>${r.contributorCount != null ? '~' + formatCount(r.contributorCount) : '—'}</td>
                <td>${relativeTime(r.pushedAt)}</td>
                <td>${r.archived ? 'yes' : 'no'}</td>
            </tr>`).join('');
        const failedNote = data.failed.length
            ? `<p class="muted small">Couldn't fetch: ${data.failed.map((f) => escapeHtml(`${f.input} (${f.error})`)).join(', ')}</p>` : '';
        results.innerHTML = `
            <div class="table-scroll">
                <table class="compare-table">
                    <thead><tr><th>Repo</th><th>Stars</th><th>Forks</th><th>Issues</th><th>Language</th><th>License</th><th>Contributors</th><th>Last pushed</th><th>Archived</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>${failedNote}`;
    } catch (err) {
        results.innerHTML = errorHtml(err.message);
    }
}

async function runExplain(owner, name) {
    const area = document.getElementById('explain-area');
    const { apiKey } = getAiSettings();
    area.innerHTML = `<div class="explain-box"><div class="spinner" style="margin:0 auto 8px"></div><span class="muted small">Asking AI about this repo…</span></div>`;
    try {
        const data = await api.explain(owner, name);
        area.innerHTML = `
            <div class="explain-box">
                <h4>✨ AI explanation${apiKey ? '' : ' <span class="muted">(free trial)</span>'}</h4>
                <div class="markdown">${renderMarkdown(data.explanation)}</div>
            </div>`;
    } catch (err) {
        const hint = apiKey ? '' : ' Add your own AI API key in Settings for unlimited use.';
        area.innerHTML = `<div class="explain-box"><p class="muted small" style="color:var(--danger)">${escapeHtml(err.message)}${hint}</p>
            <button id="explain-btn" class="btn">Try again</button></div>`;
        document.getElementById('explain-btn').addEventListener('click', () => runExplain(owner, name));
    }
}

async function renderRepoView(owner, name, tab, path) {
    setActiveNav('');
    const fullName = `${owner}/${name}`;
    app.innerHTML = `<div id="repo-root">${loadingHtml(`Loading ${escapeHtml(fullName)}…`)}</div>`;
    const root = document.getElementById('repo-root');

    let overview;
    try {
        overview = await api.repoOverview(owner, name);
    } catch (err) {
        root.innerHTML = errorHtml(err.message);
        return;
    }

    const activeTab = tab || 'overview';
    const langTotal = Object.values(overview.languages || {}).reduce((a, b) => a + b, 0);
    const langBars = Object.entries(overview.languages || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([lang, bytes]) => ({ lang, pct: langTotal ? (bytes / langTotal) * 100 : 0 }));

    root.innerHTML = `
        <div class="repo-header">
            <h1><a href="https://github.com/${owner}/${name}" target="_blank" rel="noopener">${escapeHtml(fullName)}</a>${overview.archived ? '<span class="badge">ARCHIVED</span>' : ''}</h1>
            ${overview.description ? `<p class="desc">${escapeHtml(overview.description)}</p>` : ''}
        </div>
        <div class="stat-row">
            <span>★ <strong>${formatCount(overview.stars)}</strong> stars</span>
            <span>⑂ <strong>${formatCount(overview.forks)}</strong> forks</span>
            <span><strong>${formatCount(overview.openIssues)}</strong> open issues</span>
            <span><strong>${escapeHtml(overview.license || 'No license')}</strong></span>
            ${overview.contributorCount != null ? `<span><strong>~${formatCount(overview.contributorCount)}</strong> contributors</span>` : ''}
            <span>Created ${relativeTime(overview.createdAt)} · Updated ${relativeTime(overview.pushedAt)}</span>
        </div>
        ${langBars.length ? `
            <div class="lang-bar">${langBars.map((l) => `<div class="lang-bar-segment" style="width:${l.pct}%;background:${langColor(l.lang)}"></div>`).join('')}</div>
            <div class="lang-legend">${langBars.map((l) => `<span><span class="lang-dot" style="background:${langColor(l.lang)}"></span> ${escapeHtml(l.lang)} ${l.pct.toFixed(1)}%</span>`).join('')}</div>
        ` : ''}
        <div class="tabs">
            <button class="tab-btn" data-tab="overview">Overview</button>
            <button class="tab-btn" data-tab="files">Files</button>
            <button class="tab-btn" data-tab="commits">Commits</button>
            <button class="tab-btn" data-tab="branches">Branches</button>
        </div>
        <div id="tab-content">${loadingHtml()}</div>`;

    root.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === activeTab);
        btn.addEventListener('click', () => {
            location.hash = repoPath(fullName, btn.dataset.tab);
        });
    });

    const tabContent = document.getElementById('tab-content');
    if (activeTab === 'overview') {
        const readmeHtml = overview.readme
            ? `<div class="readme-preview markdown">${renderMarkdown(overview.readme.slice(0, 8000))}</div>`
            : `<div class="state-message">No README found.</div>`;
        tabContent.innerHTML = `
            <div id="explain-area">
                <button id="explain-btn" class="btn">✨ Explain this repo with AI</button>
            </div>
            ${readmeHtml}`;
        document.getElementById('explain-btn').addEventListener('click', () => runExplain(owner, name));
    } else if (activeTab === 'files') {
        await loadFilesTab(tabContent, owner, name, path || '');
    } else if (activeTab === 'commits') {
        tabContent.innerHTML = loadingHtml();
        try {
            const data = await api.repoCommits(owner, name);
            tabContent.innerHTML = data.commits.length
                ? `<ul class="commit-list">${data.commits.map((c) => `
                    <li><span class="sha">${c.shortSha}</span> <span>${escapeHtml((c.message || '').split('\n')[0])}</span> <span class="muted">— ${escapeHtml(c.author || 'unknown')}, ${relativeTime(c.date)}</span></li>
                `).join('')}</ul>`
                : `<div class="state-message">No commits found.</div>`;
        } catch (err) {
            tabContent.innerHTML = errorHtml(err.message);
        }
    } else if (activeTab === 'branches') {
        tabContent.innerHTML = loadingHtml();
        try {
            const data = await api.repoBranches(owner, name);
            tabContent.innerHTML = `<ul class="branch-list">${data.branches.map((b) => `
                <li>${b.isDefault ? '★' : ''} <strong>${escapeHtml(b.name)}</strong> ${b.protected ? '<span class="badge" style="border-color:var(--fg-muted);color:var(--fg-muted)">protected</span>' : ''} <span class="sha">${b.sha.slice(0, 7)}</span></li>
            `).join('')}</ul>`;
        } catch (err) {
            tabContent.innerHTML = errorHtml(err.message);
        }
    }
}

async function loadFilesTab(container, owner, name, path) {
    container.innerHTML = loadingHtml();
    try {
        const structure = await api.repoStructure(owner, name, path);
        const crumbs = buildBreadcrumbs(owner, name, path);
        const items = [...structure.entries].sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
        container.innerHTML = `
            <div class="breadcrumbs">${crumbs}</div>
            <ul class="file-list">${items.map((entry) => `
                <li data-name="${escapeHtml(entry.name)}" data-type="${entry.type}">
                    ${entry.type === 'dir' ? '📁' : '📄'} ${escapeHtml(entry.name)}
                    ${entry.size != null ? `<span class="size">${formatCount(entry.size)}B</span>` : ''}
                </li>`).join('')}</ul>`;
        container.querySelectorAll('.file-list li').forEach((li) => {
            li.addEventListener('click', async () => {
                const childPath = path ? `${path}/${li.dataset.name}` : li.dataset.name;
                if (li.dataset.type === 'dir') {
                    location.hash = repoPath(`${owner}/${name}`, 'files', `path=${encodeURIComponent(childPath)}`);
                } else {
                    await showFile(container, owner, name, childPath, path);
                }
            });
        });
    } catch (err) {
        container.innerHTML = errorHtml(err.message);
    }
}

function buildBreadcrumbs(owner, name, path) {
    const fullName = `${owner}/${name}`;
    const parts = path ? path.split('/') : [];
    let acc = '';
    const links = [`<a href="${repoPath(fullName, 'files')}">${escapeHtml(fullName)}</a>`];
    for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        links.push(`<a href="${repoPath(fullName, 'files', `path=${encodeURIComponent(acc)}`)}">${escapeHtml(part)}</a>`);
    }
    return links.join(' / ');
}

async function showFile(container, owner, name, path, parentPath) {
    container.innerHTML = loadingHtml(`Loading ${path}…`);
    try {
        const file = await api.repoFile(owner, name, path);
        const crumbs = buildBreadcrumbs(owner, name, parentPath);
        if (file.binary) {
            container.innerHTML = `
                <div class="breadcrumbs">${crumbs} / ${escapeHtml(path.split('/').pop())}</div>
                <div class="state-message">This is a binary file. <a href="${file.htmlUrl}" target="_blank" rel="noopener">View on GitHub</a></div>`;
            return;
        }
        container.innerHTML = `
            <div class="breadcrumbs">${crumbs} / ${escapeHtml(path.split('/').pop())} <span class="muted small">(${formatCount(file.size)}B)</span></div>
            <div class="code-view"><pre>${escapeHtml(file.text)}</pre></div>`;
    } catch (err) {
        container.innerHTML = errorHtml(err.message);
    }
}

// ---------- router ----------

function parseHash() {
    const raw = (location.hash || '#/').slice(1);
    const [pathPart, queryStr] = raw.split('?');
    return { path: pathPart, params: new URLSearchParams(queryStr || '') };
}

function router() {
    const { path, params } = parseHash();

    const repoMatch = path.match(/^\/repo\/([^/]+)\/([^/]+)(?:\/(\w+))?$/);
    if (repoMatch) {
        const [, owner, name, tab] = repoMatch;
        return renderRepoView(owner, name, tab, params.get('path'));
    }
    const compareMatch = path.match(/^\/compare(?:\/(.*))?$/);
    if (compareMatch) return renderCompareView(decodeURIComponent(compareMatch[1] || ''));
    if (path === '/trending') return renderTrendingView();
    return renderSearchView(params.get('q'));
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => {
    router();
    wireGlobalControls();
});

// ---------- header controls ----------

function wireGlobalControls() {
    document.getElementById('global-search-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const q = document.getElementById('global-search-input').value.trim();
        if (q) location.hash = `#/?q=${encodeURIComponent(q)}`;
    });

    const panel = document.getElementById('settings-panel');
    const tokenInput = document.getElementById('token-input');
    tokenInput.value = getToken();
    document.getElementById('settings-toggle').addEventListener('click', () => {
        panel.hidden = !panel.hidden;
    });
    document.getElementById('token-save').addEventListener('click', () => {
        try {
            localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
        } catch { /* localStorage unavailable — token just won't persist */ }
        panel.hidden = true;
    });
    document.getElementById('token-clear').addEventListener('click', () => {
        tokenInput.value = '';
        try {
            localStorage.removeItem(TOKEN_KEY);
        } catch { /* ignore */ }
    });

    const aiKeyInput = document.getElementById('ai-key-input');
    const aiProviderInput = document.getElementById('ai-provider-input');
    const initialAi = getAiSettings();
    aiKeyInput.value = initialAi.apiKey;
    aiProviderInput.value = initialAi.provider;
    document.getElementById('ai-key-save').addEventListener('click', () => {
        try {
            localStorage.setItem(AI_KEY_KEY, aiKeyInput.value.trim());
            localStorage.setItem(AI_PROVIDER_KEY, aiProviderInput.value);
        } catch { /* localStorage unavailable — key just won't persist */ }
        panel.hidden = true;
    });
    document.getElementById('ai-key-clear').addEventListener('click', () => {
        aiKeyInput.value = '';
        try {
            localStorage.removeItem(AI_KEY_KEY);
        } catch { /* ignore */ }
    });
}
