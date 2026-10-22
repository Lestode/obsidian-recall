const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { run, runCodex, collectContext, parseCommand, codexEnvironment } = require('./review.cjs');

function fixture() {
  const calls = { reviews: [], responses: [], failures: [], summaries: [], warnings: [] };
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
  const files = [{ filename: 'docs/README.md', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-Original governing rule\n+Proposed changed rule' }];
  const comments = [{ body: 'Earlier decision', created_at: '2026-01-01', user: { login: 'author' } }];
  const github = {
    rest: {
      repos: {
        getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }),
        compareCommitsWithBasehead: async () => ({ data: { merge_base_commit: { sha: 'accepted' } } }),
      },
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
    core: {
      setFailed: message => calls.failures.push(message),
      warning: message => calls.warnings.push(message),
      summary: { addRaw: body => ({ write: async () => { calls.summaries.push(body); } }) },
    },
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
  assert.match(f.calls.responses[0].body, /## 🤖 Documentation reviewer/);
  assert.match(f.calls.responses[0].body, /Automated agent · Codex · local execution/);
  assert.match(f.calls.responses[0].body, /\*\*Purpose:\*\*/);
  assert.match(f.calls.responses[0].body, /recall-documentation-review:42/);
  assert.match(f.calls.responses[0].body, /files\/proposed/);
  assert.match(f.calls.responses[0].body, /`\/review-docs <your reply>`.*Conversation/);
  assert.match(f.calls.responses[0].body, /Agreed changes must be applied separately\.$/);
  assert.deepEqual(f.calls.failures, []);
});

for (const scenario of ['public', 'bot', 'read-only collaborator', 'edited comment']) {
  test(`${scenario} cannot start the local reviewer`, async () => {
    const f = fixture();
    if (scenario === 'public') f.context.payload.repository.private = false;
    if (scenario === 'bot') f.context.payload.comment.user.type = 'Bot';
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

for (const state of ['closed', 'merged']) {
  test(`a command on a ${state} PR posts guidance without collecting source or running Codex`, async () => {
    const f = fixture();
    f.pull.state = 'closed';
    if (state === 'merged') f.pull.merged_at = '2026-10-22T09:42:06Z';
    const reads = [];
    f.github.paginate = async method => {
      reads.push(method);
      assert.equal(method, 'comments');
      return f.comments;
    };
    await run(f);
    assert.deepEqual(reads, ['comments']);
    assert.equal(f.calls.reviews.length, 0);
    assert.equal(f.calls.responses.length, 1);
    const body = f.calls.responses[0].body;
    assert.ok(body.includes(`This PR is ${state}`));
    assert.match(body, /no review ran/);
    assert.match(body, /follow-up PR/);
    assert.match(body, /`\/review-docs <your reply>` in an open PR's \*\*Conversation\*\*/);
    assert.doesNotMatch(body, /Later pushes/);
    assert.equal(f.calls.summaries[0], body);
    assert.deepEqual(f.calls.failures, []);

    f.comments.push({ body, user: { login: 'github-actions[bot]' } });
    await run(f);
    assert.equal(f.calls.responses.length, 1);
    assert.equal(f.calls.reviews.length, 0);
  });
}

test('an automatic event for a closed PR remains silent', async () => {
  const f = fixture();
  f.pull.state = 'closed';
  f.context.eventName = 'pull_request_target';
  f.context.payload.action = 'opened';
  f.context.payload.pull_request = { number: 7, user: { login: 'author', type: 'User' } };
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
  assert.match(f.calls.responses[0].body, /Automated agent · Codex · local execution/);
  assert.match(f.calls.responses[0].body, /`\/review-docs <your reply>`.*Conversation/);
  assert.match(f.calls.responses[0].body, /Agreed changes must be applied separately\.$/);
  assert.equal(f.calls.failures.length, 1);
});

test('input above the former 240 KB cap keeps the complete discussion within 512 KB', async () => {
  const f = fixture();
  const body = 'Earlier decision. '.repeat(18_000);
  f.comments.push({ body });
  const prompt = await collectContext({ ...f, repo: f.context.repo, question: '' });
  assert.ok(Buffer.byteLength(prompt) > 240_000);
  assert.ok(Buffer.byteLength(prompt) <= 512_000);
  assert.equal(promptData(prompt).discussion.at(-1).body, body);
});

test('oversized discussion fails explicitly instead of silently dropping context', async () => {
  const f = fixture();
  f.comments.push({ body: 'x'.repeat(512_001) });
  await assert.rejects(collectContext({ ...f, repo: f.context.repo, question: '' }), /context limit/);
});

test('truncated source retrieval does not reach the model', async () => {
  const f = fixture();
  f.github.rest.git.getTree = async () => ({ data: { truncated: true } });
  await run(f);
  assert.equal(f.calls.reviews.length, 0);
  assert.match(f.calls.responses[0].body, /Review incomplete/);
});

test('initial discussion retrieval failure produces a controlled incomplete response', async () => {
  const f = fixture();
  const paginate = f.github.paginate;
  f.github.paginate = async method => {
    if (method === 'comments') throw new Error('Remote error containing private diagnostic data');
    return paginate(method);
  };
  await run(f);
  assert.equal(f.calls.reviews.length, 0);
  assert.equal(f.calls.responses.length, 1);
  assert.match(f.calls.responses[0].body, /Review incomplete/);
  assert.doesNotMatch(f.calls.responses[0].body, /private diagnostic/);
  assert.equal(f.calls.failures.length, 1);
});

test('unverifiable authorization fails in Actions without starting an agent or posting', async () => {
  const f = fixture();
  f.github.rest.repos.getCollaboratorPermissionLevel = async () => { throw new Error('Unavailable'); };
  await run(f);
  assert.equal(f.calls.reviews.length, 0);
  assert.equal(f.calls.responses.length, 0);
  assert.equal(f.calls.failures.length, 1);
});

test('posting failure falls back to a failed Actions job', async () => {
  const f = fixture();
  f.github.rest.issues.createComment = async () => { throw new Error('Unavailable'); };
  await run(f);
  assert.equal(f.calls.reviews.length, 1);
  assert.equal(f.calls.failures.length, 1);
  assert.match(f.calls.failures[0], /could not accept/);
  assert.equal(f.calls.summaries.length, 1);
  assert.match(f.calls.summaries[0], /A concrete finding/);
  assert.match(f.calls.failures[0], /report is available/);
});

test('publication diagnostics expose HTTP status without request secrets or raw error text', async () => {
  const f = fixture();
  f.github.rest.issues.createComment = async () => {
    throw Object.assign(new Error('private-api-response'), {
      status: 403, request: { headers: { authorization: 'secret-token' } },
    });
  };
  await run(f);
  assert.match(f.calls.failures[0], /HTTP 403/);
  assert.doesNotMatch(JSON.stringify(f.calls), /secret-token|private-api-response/);
  assert.match(f.calls.summaries[0], /A concrete finding/);
});

test('a lost summary plus failed publication does not falsely claim the report was saved', async () => {
  const f = fixture();
  f.core.summary.addRaw = () => ({ write: async () => { throw new Error('Unavailable'); } });
  f.github.rest.issues.createComment = async () => { throw new Error('Unavailable'); };
  await run(f);
  assert.equal(f.calls.warnings.length, 1);
  assert.match(f.calls.failures[0], /could not be saved/);
});

test('the Codex subprocess receives the approved model and high reasoning effort', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recall-codex-test-'));
  const capture = join(directory, 'arguments.json');
  const binary = join(directory, 'fake-codex.cjs');
  const previous = process.env.REVIEW_CODEX_BIN;
  await writeFile(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(args));
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'A review.');
process.stdin.resume();
`, { mode: 0o700 });
  process.env.REVIEW_CODEX_BIN = binary;
  try {
    assert.equal(await runCodex('Review the proposal.'), 'A review.');
    const args = JSON.parse(await readFile(capture, 'utf8'));
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6.1-sol');
    assert.ok(args.includes('model_reasoning_effort="high"'));
    assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
    const f = fixture();
    await run(f);
    assert.match(f.calls.responses[0].body, /Model:\*\* gpt-6.1-sol/);
    assert.match(f.calls.responses[0].body, /Reasoning effort:\*\* high/);
  } finally {
    if (previous === undefined) delete process.env.REVIEW_CODEX_BIN;
    else process.env.REVIEW_CODEX_BIN = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

function promptData(prompt) {
  return JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));
}

test('one latest snapshot supplies unchanged documents once and keeps earlier rules in diffs', async () => {
  const f = fixture();
  f.files[0].filename = 'docs/rule.md';
  const reads = [];
  const shared = 'Unchanged governing context. '.repeat(3000);
  f.github.rest.git.getTree = async ({ tree_sha }) => {
    reads.push(`tree:${tree_sha}`);
    assert.equal(tree_sha, 'proposed');
    return { data: { tree: [
      { type: 'blob', path: 'docs/README.md', sha: 'shared' },
      { type: 'blob', path: 'docs/rule.md', sha: 'proposed' },
    ] } };
  };
  f.github.rest.git.getBlob = async ({ file_sha }) => {
    reads.push(`blob:${file_sha}`);
    const content = file_sha === 'shared' ? shared : 'Proposed changed rule';
    return { data: { content: Buffer.from(content).toString('base64'), encoding: 'base64', size: Buffer.byteLength(content) } };
  };
  const prompt = await collectContext({ ...f, repo: f.context.repo, question: '' });
  const data = promptData(prompt);
  assert.equal(data.documents.length, 2);
  assert.equal(data.documents[0].content, shared);
  assert.equal(prompt.split(shared).length - 1, 1);
  assert.equal(data.accepted, undefined);
  assert.equal(data.proposed, undefined);
  assert.ok(data.changes[0].patch.includes('-Original governing rule'));
  assert.deepEqual(reads, ['tree:proposed', 'blob:shared', 'blob:proposed']);
});

test('large added Markdown fits without repeating its full addition patch', async () => {
  const f = fixture();
  const content = 'A newly proposed rule.\n'.repeat(5000);
  f.files[0] = { filename: 'docs/README.md', status: 'added', additions: 5000, deletions: 0 };
  f.github.rest.git.getBlob = async () => ({ data: {
    content: Buffer.from(content).toString('base64'), encoding: 'base64', size: Buffer.byteLength(content),
  } });
  const prompt = await collectContext({ ...f, repo: f.context.repo, question: '' });
  const data = promptData(prompt);
  assert.equal(data.documents[0].content, content);
  assert.match(data.changes[0].patch, /New Markdown document/);
  assert.doesNotMatch(data.changes[0].patch, /newly proposed rule/);
  assert.ok(Buffer.byteLength(prompt) < 512_000);
});

test('deleted documents keep every earlier rule in their deletion patches', async () => {
  const f = fixture();
  f.files[0] = { filename: 'docs/deleted.md', status: 'removed', additions: 0, deletions: 2,
    patch: '@@ -1,2 +0,0 @@\n-Original governing rule\n-Never reset progress.' };
  const data = promptData(await collectContext({ ...f, repo: f.context.repo, question: '' }));
  assert.ok(data.documents.every(document => document.path !== 'docs/deleted.md'));
  assert.match(data.changes[0].patch, /-Never reset progress\./);
});

for (const path of ['docs/renamed.md', 'docs/renamed.txt']) {
  test(`path-only rename to ${path} keeps one content copy and both paths`, async () => {
    const f = fixture();
    f.files[0] = { filename: path, previous_filename: 'docs/old.md', status: 'renamed', additions: 0, deletions: 0 };
    f.github.rest.git.getTree = async () => ({ data: { tree: [
      { type: 'blob', path: 'docs/README.md', sha: 'index' }, { type: 'blob', path, sha: 'rule' },
    ] } });
    const data = promptData(await collectContext({ ...f, repo: f.context.repo, question: '' }));
    assert.equal(data.changes[0].previousPath, 'docs/old.md');
    assert.match(data.changes[0].patch, /Path-only rename/);
    assert.ok(data.documents.some(document => document.path === path));
  });
}

test('modified renames retain their complete diff, including no-newline markers', async () => {
  const f = fixture();
  f.files[0] = { filename: 'docs/README.md', previous_filename: 'docs/old.md', status: 'renamed', additions: 2, deletions: 2,
    patch: '@@ -1,2 +1,2 @@\n-Old rule\n-Removed qualification\n+New rule\n+New qualification\n\\ No newline at end of file' };
  const data = promptData(await collectContext({ ...f, repo: f.context.repo, question: '' }));
  assert.equal(data.changes[0].patch, f.files[0].patch);
});

for (const patch of [
  '@@ -1,2 +1,2 @@\n-Original governing rule\n+Proposed changed rule',
  '@@ -1 +1 @@\n-Original governing rule',
  '-Original governing rule\n+Proposed changed rule',
]) {
  test(`incomplete Markdown patch stops the model: ${patch.split('\n')[0]}`, async () => {
    const f = fixture(); f.files[0].patch = patch;
    await run(f);
    assert.equal(f.calls.reviews.length, 0);
    assert.match(f.calls.responses[0].body, /omitted or truncated a Markdown patch/);
    assert.equal(f.calls.failures.length, 1);
  });
}

test('Markdown change totals must account for all changed lines', async () => {
  const f = fixture(); f.files[0].additions = 2;
  await assert.rejects(collectContext({ ...f, repo: f.context.repo, question: '' }), /truncated a Markdown patch/);
});

test('the Markdown file list must agree with the latest tree', async () => {
  const f = fixture(); f.files[0].filename = 'docs/missing.md';
  await assert.rejects(collectContext({ ...f, repo: f.context.repo, question: '' }), /tree disagree/);
});

test('a push during collection cannot produce a mixed-revision review', async () => {
  const f = fixture();
  f.github.rest.pulls.get = async () => ({ data: { ...f.pull, head: { sha: 'later' } } });
  await assert.rejects(collectContext({ ...f, repo: f.context.repo, question: '' }), /PR changed while collecting context/);
});

test('the input cap includes instructions and procedure, not only JSON', async () => {
  const f = fixture();
  const small = await collectContext({ ...f, repo: f.context.repo, question: '' });
  const dataBytes = Buffer.byteLength(JSON.stringify(promptData(small)));
  const overhead = Buffer.byteLength(small) - dataBytes;
  f.comments.push({ body: 'x'.repeat(512_000 - dataBytes - Math.floor(overhead / 2)) });
  await assert.rejects(collectContext({ ...f, repo: f.context.repo, question: '' }),
    /complete review input is \d+ bytes, exceeding the 512000-byte context limit/);
});


test('rules accepted on a diverged target remain available without another full snapshot', async () => {
  const f = fixture();
  const comparisons = [];
  f.github.rest.repos.compareCommitsWithBasehead = async ({ basehead }) => {
    comparisons.push(basehead);
    return { data: basehead === 'accepted...proposed'
      ? { merge_base_commit: { sha: 'common' } }
      : { files: [
        { filename: 'docs/new-target-rule.md', status: 'added', sha: 'target-rule' },
        { filename: 'docs/deleted.md', status: 'removed' },
        { filename: 'docs/renamed.md', previous_filename: 'docs/old.md', status: 'renamed', sha: 'proposed' },
        { filename: 'code.cjs', status: 'modified', sha: 'code' },
      ] } };
  };
  const getBlob = f.github.rest.git.getBlob;
  f.github.rest.git.getBlob = async args => args.file_sha === 'target-rule'
    ? { data: { content: Buffer.from('Newly agreed target rule').toString('base64'), encoding: 'base64', size: 23 } }
    : getBlob(args);
  const data = promptData(await collectContext({ ...f, repo: f.context.repo, question: '' }));
  assert.deepEqual(comparisons, ['accepted...proposed', 'common...accepted']);
  assert.equal(data.proposal.mergeBase, 'common');
  assert.equal(data.documents.length, 1);
  assert.equal(data.acceptedTargetUpdates[0].content, 'Newly agreed target rule');
  assert.equal(data.acceptedTargetUpdates[1].status, 'removed');
  assert.equal(data.acceptedTargetUpdates[2].documentPath, 'docs/README.md');
  assert.equal(data.acceptedTargetUpdates[2].content, undefined);
  assert.equal(data.acceptedTargetUpdates.length, 3);
});

test('possibly truncated target changes cannot silently lose accepted rules', async () => {
  const f = fixture();
  f.github.rest.repos.compareCommitsWithBasehead = async ({ basehead }) => ({ data:
    basehead === 'accepted...proposed' ? { merge_base_commit: { sha: 'common' } }
      : { files: Array.from({ length: 300 }, () => ({ filename: 'docs/rule.md' })) },
  });
  await run(f);
  assert.equal(f.calls.reviews.length, 0);
  assert.match(f.calls.responses[0].body, /Target-branch changes are incomplete/);
});
