'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { main, post, api } = require('../src/action');
const sha = 'a'.repeat(40);
const config = { tag: 'v1/test', sha, repository: 'owner/repo' };
const missing = () => Object.assign(new Error('missing'), { status: 404 });

function setup(responses) {
  const calls = [], state = {}, outputs = {};
  return {
    calls, state, outputs,
    commands: { save: (key, value) => { state[key] = value; }, output: (key, value) => { outputs[key] = value; } },
    request: async (...args) => {
      calls.push(args);
      assert.ok(responses.length, 'Unexpected API call');
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

test('creates an annotated tag and deletes it in post', async () => {
  const s = setup([missing(), { sha }, { sha: 'b'.repeat(40) }, {}, undefined]);
  await main(config, s.request, s.commands);
  assert.equal(s.state.created, 'true');
  assert.equal(s.outputs.created, 'true');
  assert.equal(s.calls[2][2].type, 'commit');
  assert.equal(s.calls[2][2].object, sha);
  assert.equal(s.calls[2][2].message, config.tag);
  assert.equal(s.calls[2][2].tagger.name, 'github-actions[bot]');
  assert.deepEqual(s.calls[3][2], { ref: 'refs/tags/v1/test', sha: 'b'.repeat(40) });
  await post(s.state, s.request);
  assert.deepEqual(s.calls[4], ['DELETE', '/repos/owner/repo/git/refs/tags/v1%2Ftest']);
});

for (const annotated of [false, true]) {
  test(`existing ${annotated ? 'annotated' : 'lightweight'} tag at target is preserved`, async () => {
    const s = setup(annotated
      ? [{ object: { type: 'tag', sha: 'b'.repeat(40) } }, { object: { type: 'commit', sha } }]
      : [{ object: { type: 'commit', sha } }]);
    await main(config, s.request, s.commands);
    assert.equal(s.outputs.created, 'false');
    await post(s.state, s.request);
    assert.equal(s.calls.length, annotated ? 2 : 1);
  });
}

test('existing tag at another commit fails without cleanup', async () => {
  const s = setup([{ object: { type: 'commit', sha: 'c'.repeat(40) } }]);
  await assert.rejects(main(config, s.request, s.commands), /different target/);
  await post(s.state, s.request);
  assert.equal(s.calls.length, 1);
});

for (const same of [true, false]) {
  test(`creation race with ${same ? 'same' : 'different'} commit never claims ownership`, async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 422 });
    const s = setup([missing(), { sha }, { sha: 'b'.repeat(40) }, conflict,
      { object: { type: 'commit', sha: same ? sha : 'c'.repeat(40) } }]);
    if (same) await main(config, s.request, s.commands);
    else await assert.rejects(main(config, s.request, s.commands), /different target/);
    assert.equal(s.state.created, undefined);
    await post(s.state, s.request);
    assert.equal(s.calls.length, 5);
  });
}

test('API creation failure never enables cleanup', async () => {
  const s = setup([missing(), { sha }, { sha: 'b'.repeat(40) }, Object.assign(new Error('forbidden'), { status: 403 })]);
  await assert.rejects(main(config, s.request, s.commands), /forbidden/);
  await post(s.state, s.request);
  assert.equal(s.calls.length, 4);
});

test('cleanup tolerates already removed tags and propagates permission failures', async () => {
  const state = { created: 'true', repository: config.repository, tag: config.tag };
  await post(state, setup([missing()]).request);
  await assert.rejects(post(state, setup([Object.assign(new Error('forbidden'), { status: 403 })]).request), /forbidden/);
});

test('validates inputs before any API calls', async () => {
  for (const override of [{ sha: 'abc' }, { repository: 'bad' }, { tag: '../bad' }, { tag: 'bad\nname' }, { tag: 'refs/tags/v1' }]) {
    const s = setup([]);
    await assert.rejects(main({ ...config, ...override }, s.request, s.commands));
    assert.equal(s.calls.length, 0);
  }
});

test('API authenticates, serializes requests, and handles no-content responses', async () => {
  let options;
  const request = api('secret', async (url, opts) => {
    assert.equal(url, 'https://api.github.com/test');
    options = opts;
    return { ok: true, status: 204 };
  });
  await request('POST', '/test', { hello: 'world' });
  assert.equal(options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(options.body), { hello: 'world' });
});
