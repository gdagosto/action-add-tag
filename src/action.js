'use strict';

const { appendFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

function input(name) {
  return (process.env[`INPUT_${name.toUpperCase()}`] || '').trim();
}

function writeCommand(file, name, value) {
  if (!file) throw new Error(`Missing runner command file for ${name}`);
  const delimiter = randomUUID();
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
}

function runner() {
  return {
    save: (name, value) => writeCommand(process.env.GITHUB_STATE, name, value),
    output: (name, value) => writeCommand(process.env.GITHUB_OUTPUT, name, value),
  };
}

function api(token, fetchImpl = fetch) {
  return async (method, path, body) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'action-add-tag',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      // Avoid printing response bodies, which might contain secrets or workflow commands.
      const error = new Error(`GitHub API ${method} ${path} failed (HTTP ${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? undefined : response.json();
  };
}

function basePath(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('repository must use owner/repo format');
  }
  return `/repos/${repository}`;
}

function validateTag(tag) {
  if (!tag || tag.startsWith('-') || tag.startsWith('refs/') ||
      /[\x00-\x20\x7f~^:?*\[\\]/.test(tag) || tag.includes('..') ||
      tag.includes('@{') || tag.endsWith('.') ||
      tag.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    throw new Error('tag must be a valid Git tag name without refs/tags/');
  }
}

async function getRef(request, base, tag) {
  try {
    return await request('GET', `${base}/git/ref/tags/${encodeURIComponent(tag)}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function checkTarget(request, base, ref, sha) {
  let object = ref.object;
  const seen = new Set();
  while (object.type === 'tag') {
    if (seen.has(object.sha)) throw new Error('Tag object cycle detected');
    seen.add(object.sha);
    object = (await request('GET', `${base}/git/tags/${object.sha}`)).object;
  }
  if (object.type !== 'commit' || object.sha.toLowerCase() !== sha) {
    throw new Error(`Tag already exists on a different target (${object.sha})`);
  }
}

async function main(config, request, commands) {
  const { tag, repository } = config;
  const sha = config.sha.toLowerCase();
  validateTag(tag);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('commit_sha must be a full 40-character commit SHA');
  const base = basePath(repository);
  const existing = await getRef(request, base, tag);
  if (existing) {
    await checkTarget(request, base, existing, sha);
    commands.output('created', 'false');
    commands.output('commit_sha', sha);
    return;
  }

  // Verify that this is a commit, not another Git object, before creating an annotation.
  await request('GET', `${base}/git/commits/${sha}`);
  const annotation = await request('POST', `${base}/git/tags`, {
    tag, message: config.message || tag, object: sha, type: 'commit',
    tagger: {
      name: 'github-actions[bot]',
      email: '41898282+github-actions[bot]@users.noreply.github.com',
      date: new Date().toISOString(),
    },
  });
  // Save identity before mutation; enable cleanup only after confirmed creation.
  commands.save('repository', repository);
  commands.save('tag', tag);
  try {
    await request('POST', `${base}/git/refs`, { ref: `refs/tags/${tag}`, sha: annotation.sha });
  } catch (error) {
    if (error.status !== 422 && error.status !== 409) throw error;
    // Another invocation may have won the race. Never claim ownership of its tag.
    const raced = await getRef(request, base, tag);
    if (!raced) throw error;
    await checkTarget(request, base, raced, sha);
    commands.output('created', 'false');
    commands.output('commit_sha', sha);
    return;
  }
  commands.save('created', 'true');
  commands.output('created', 'true');
  commands.output('commit_sha', sha);
}

async function post(state, request) {
  if (state.created !== 'true') return;
  const base = basePath(state.repository);
  validateTag(state.tag);
  try {
    await request('DELETE', `${base}/git/refs/tags/${encodeURIComponent(state.tag)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}

function fail(error) {
  const escaped = String(error.message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  process.stdout.write(`::error::${escaped}\n`);
  process.exitCode = 1;
}

module.exports = { input, runner, api, main, post, fail };
