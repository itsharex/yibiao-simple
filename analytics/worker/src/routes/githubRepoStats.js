import { GITHUB_REPO_FULL_NAME, GITHUB_REPO_STATS_CACHE_KEY, GITHUB_REPO_STATS_CACHE_TTL_SECONDS } from '../constants.js';
import { json, methodNotAllowed, requireAdmin, unauthorized } from '../http.js';

function normalizeRepoStats(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  return {
    fullName: String(data.full_name || data.fullName || GITHUB_REPO_FULL_NAME),
    htmlUrl: String(data.html_url || data.htmlUrl || `https://github.com/${GITHUB_REPO_FULL_NAME}`),
    stars: Number(data.stargazers_count ?? data.stars ?? 0),
    forks: Number(data.forks_count ?? data.forks ?? 0),
    openIssues: Number(data.open_issues_count ?? data.openIssues ?? 0),
    updatedAt: String(data.updated_at || data.updatedAt || ''),
  };
}

async function readCachedStats(env) {
  if (!env.NOTICE_STORE) {
    return null;
  }

  let raw;
  try {
    raw = await env.NOTICE_STORE.get(GITHUB_REPO_STATS_CACHE_KEY);
  } catch (error) {
    console.warn('[analytics] github repo stats cache read failed', error?.message || String(error));
    return null;
  }
  if (!raw) {
    return null;
  }

  try {
    return normalizeRepoStats(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeCachedStats(env, repo) {
  if (!env.NOTICE_STORE || !repo) {
    return;
  }

  try {
    await env.NOTICE_STORE.put(GITHUB_REPO_STATS_CACHE_KEY, JSON.stringify(repo), {
      expirationTtl: GITHUB_REPO_STATS_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.warn('[analytics] github repo stats cache write failed', error?.message || String(error));
  }
}

async function fetchRepoStats() {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO_FULL_NAME}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OpenBidKit-Yibiao-Analytics',
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return normalizeRepoStats(await response.json());
}

export async function handleGitHubRepoStats(request, env) {
  if (request.method !== 'GET') {
    return methodNotAllowed();
  }

  if (!requireAdmin(request, env)) {
    return unauthorized();
  }

  const cached = await readCachedStats(env);
  if (cached) {
    return json({ code: 0, repo: cached, cached: true });
  }

  try {
    const repo = await fetchRepoStats();
    await writeCachedStats(env, repo);
    return json({ code: 0, repo, cached: false });
  } catch (error) {
    console.error('[analytics] github repo stats failed', error?.message || String(error));
    return json({ code: 0, repo: null, cached: false });
  }
}
