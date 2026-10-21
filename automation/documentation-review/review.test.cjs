const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run, collectContext, parseCommand, codexEnvironment } = require('./review.cjs');

function fixture() {
  const calls = { reviews: [], responses: [], failures: [] };
  const context = {
    repo: { owner: 'owner', repo: 'private-repo' },
    payload: {
      action: 'created', repository: { private: true },
      issue: { number: 7, pull_request: {} },
      comment: { id: 42, body: '/review-docs explain the open conflict', user: { login: 'author', type: 'User' } },
    },
  };
  const pull = {
    number: 7, state: 'open', title: 'Clarify a rule', body: 'Intent', changed_files: 1,
    base: { sha: 'accepted' }, head: { sha: 'proposed' },
  };
  const files = [{ filename: 'docs/README.md', status: 'modified', patch: '-Old rule\n+New rule' }];
  const comments = [{ body: 'Earlier decision', created_at: '2026-01-01', user: { login: 'author' } }];
  const github = {
    rest: {
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }) },
      pulls: {
        get: async () => ({ data: pull }), listFiles: 'files',
        listReviewComments: 'inline', listReviews: 'reviews',
      },
      issues: {
        listComments: 'comments',
        createComment: async response => { calls.responses.push(response); },
      },
      git: {
        getTree: async ({ tree_sha }) => ({ data: { tree: [{
          type: 'blob', path: 'docs/README.md', sha: tree_sha,
        }] } }),
        getBlob: async ({ file_sha }) => ({ data: {
          content: Buffer.from(file_sha === 'accepted' ? 'Original governing rule' : 'Proposed changed rule').toString('base64'),
          encoding: 'base64', size: 30,
        } }),
      },
    },
    paginate: async method => ({
      files, comments,
      inline: [{ body: 'Inline concern', path: 'docs/README.md', line: 2, created_at: '2026-01-02' }],
      reviews: [{ body: 'Review decision', submitted_at: '2026-01-03' }],
    }[method]),
  };
  return {
    github, context, pull, files, comments, calls,
    core: { setFailed: message => calls.failures.push(message) },
    review: async prompt => { calls.reviews.push(prompt); return 'A concrete finding.'; },
  };
}

test('only the exact command starts a review; follow-up text remains intact', () => {
  assert.equal(parseCommand('/review-docs'), '');
  assert.equal(parseCommand('/review-docs\nWhat about the second finding?'), 'What about the second finding?');
  for (const body of ['/review-docs-extra', 'quoted /review-docs', '', undefined]) {
    assert.equal(parseCommand(body), null);
  }
});

test('the model subprocess does not inherit job credentials or API billing keys', () => {
  const env = codexEnvironment({
    HOME: '/local', PATH: '/bin', REVIEW_CODEX_HOME: '/persistent-auth',
    GITHUB_TOKEN: 'github-secret', GH_TOKEN: 'cli-secret', OPENAI_API_KEY: 'billing-secret',
    ANTHROPIC_API_KEY: 'other-secret', NODE_OPTIONS: '--require=untrusted.cjs',
  });
  assert.deepEqual(env, { HOME: '/local', PATH: '/bin', CODEX_HOME: '/persistent-auth' });
});

test('a follow-up reviews both immutable revisions and prior PR discussion, then replies once', async () => {
  const f = fixture();
  await run(f);
  assert.equal(f.calls.reviews.length, 1);
  const prompt = f.calls.reviews[0];
  for (const expected of ['Original governing rule', 'Proposed changed rule', 'Earlier decision', 'Inline concern', 'Review decision', 'explain the open conflict']) {
    assert.ok(prompt.includes(expected), expected);
  }
  assert.equal(f.calls.responses.length, 1);
  assert.match(f.calls.responses[0].body, /A concrete finding/);
  assert.match(f.calls.responses[0].body, /recall-documentation-review:42/);
  assert.match(f.calls.responses[0].body, /files\/proposed/);
  assert.deepEqual(f.calls.failures, []);
});

for (const scenario of ['public', 'bot', 'closed', 'read-only collaborator', 'edited comment']) {
  test(`${scenario} cannot start the local reviewer`, async () => {
    const f = fixture();
    if (scenario === 'public') f.context.payload.repository.private = false;
    if (scenario === 'bot') f.context.payload.comment.user.type = 'Bot';
    if (scenario === 'closed') f.pull.state = 'closed';
    if (scenario === 'edited comment') f.context.payload.action = 'edited';
    if (scenario === 'read-only collaborator') {
      f.github.rest.repos.getCollaboratorPermissionLevel = async () => ({ data: { permission: 'read' } });
    }
    await run(f);
    assert.equal(f.calls.reviews.length, 0);
    assert.equal(f.calls.responses.length, 0);
  });
}

test('rerunning the same request preserves its existing response', async () => {
  const f = fixture();
  f.comments.push({ body: '<!-- recall-documentation-review:42 -->\nExisting response', user: { login: 'github-actions[bot]' } });
  await run(f);
  assert.equal(f.calls.reviews.length, 0);
  assert.equal(f.calls.responses.length, 0);
});

test('opening a PR automatically reviews it without a command comment', async () => {
  const f = fixture();
  f.context.eventName = 'pull_request_target';
  f.context.payload.action = 'opened';
  f.context.payload.pull_request = { number: 7, user: { login: 'author', type: 'User' } };
  delete f.context.payload.comment;
  delete f.context.payload.issue;
  await run(f);
  assert.equal(f.calls.reviews.length, 1);
  assert.match(f.calls.responses[0].body, /recall-documentation-review:pr-7-proposed/);
});

test('automatic review rejects an author without write access', async () => {
  const f = fixture();
  f.context.eventName = 'pull_request_target';
  f.context.payload.action = 'opened';
  f.context.payload.pull_request = { number: 7, user: { login: 'reader', type: 'User' } };
  f.github.rest.repos.getCollaboratorPermissionLevel = async () => ({ data: { permission: 'read' } });
  await run(f);
  assert.equal(f.calls.reviews.length, 0);
  assert.equal(f.calls.responses.length, 0);
});

test('reopening a previously reviewed revision does not duplicate its automatic response', async () => {
  const f = fixture();
  f.context.eventName = 'pull_request_target';
  f.context.payload.action = 'reopened';
  f.context.payload.pull_request = { number: 7, user: { login: 'author', type: 'User' } };
  f.comments.push({ body: '<!-- recall-documentation-review:pr-7-proposed -->', user: { login: 'github-actions[bot]' } });
  await run(f);
  assert.equal(f.calls.reviews.length, 0);
});

test('a missing Markdown diff produces a visible incomplete result, never a clean review', async () => {
  const f = fixture();
  delete f.files[0].patch;
  await run(f);
  assert.equal(f.calls.reviews.length, 0);
  assert.match(f.calls.responses[0].body, /Review incomplete/);
  assert.equal(f.calls.failures.length, 1);
});

test('oversized discussion fails explicitly instead of silently dropping context', async () => {
  const f = fixture();
  f.comments.push({ body: 'x'.repeat(240_001) });
  await assert.rejects(collectContext({ ...f, repo: f.context.repo, question: '' }), /context limit/);
});

test('truncated source retrieval does not reach the model', async () => {
  const f = fixture();
  f.github.rest.git.getTree = async () => ({ data: { truncated: true } });
  await run(f);
  assert.equal(f.calls.reviews.length, 0);
  assert.match(f.calls.responses[0].body, /Review incomplete/);
});
