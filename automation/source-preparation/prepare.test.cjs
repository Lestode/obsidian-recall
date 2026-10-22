const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile, symlink } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { renderSourceNote, writeSourceNote } = require('./prepare.ts');
const { parseRecallQuestions } = require('../../packages/core/src/grammar.ts');
const { scanVault } = require('../../apps/local-service/src/scanner.ts');

function draft() {
  return {
    source: { kind: 'website', title: 'A source', location: 'https://example.org/lesson', scope: 'Core concepts' },
    title: 'Core concepts', sections: [{ title: 'Definitions', questions: [{
      prompt: 'In the lesson, what is the value of the defined constant?',
      answer: 'It is $c=2$.\n\n### Worked example\n\n- Keep this list.\n\n```md\n**Q:** Literal example, not another question.\n```',
      references: [{ url: 'https://example.org/lesson#definition', label: 'Definition' }],
    }] }],
  };
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'recall-preparation-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = path.join(root, 'Course', 'Subject');
  await mkdir(parent, { recursive: true });
  await writeFile(path.join(root, 'Course', '_recall.md'), '# Course\n');
  return { root, parent };
}

test('a completed source note retains rich answers and indexes through the existing scanner', async t => {
  const { root, parent } = await fixture(t);
  const input = draft();
  input.sections.push({ title: 'Consequences', questions: [{
    ...input.sections[0].questions[0], prompt: 'In the lesson, what follows from the definition?', answer: 'A consequence.',
  }] });
  const result = await writeSourceNote(input, parent, 'none');
  assert.equal(result.collection, path.join(root, 'Course'));
  assert.equal(result.questionCount, 2);
  const note = await readFile(result.filePath, 'utf8');
  const scan = await scanVault(root);
  assert.deepEqual(scan.diagnostics, []);
  assert.equal(scan.records.length, 2);
  assert.deepEqual(scan.records.map(r => r.sectionPath), [
    ['Core concepts', 'Definitions'], ['Core concepts', 'Consequences'],
  ]);
  assert.deepEqual(scan.records.map(r => r.questionOrdinal), [0, 1]);
  assert.ok(scan.records[0].answer.startsWith(input.sections[0].questions[0].answer));
  assert.match(scan.records[0].answer, /https:\/\/example.org\/lesson#definition/);
  assert.ok(parseRecallQuestions(note).every(q => q.identityLine === q.questionLine + 1));
  assert.deepEqual(await readdir(path.dirname(result.filePath)), ['Core concepts.md']);
});

test('PDF questions require physical page references and produce navigable source links', () => {
  const input = draft();
  input.source.kind = 'pdf';
  input.source.location = '/tmp/A source.pdf';
  input.sections[0].questions[0].references = [{ page: 3 }];
  const note = renderSourceNote(input).markdown;
  assert.match(note, /file:\/\/\/tmp\/A%20source.pdf#page=3/);
  for (const page of [0, -1, 1.5, '3', undefined]) {
    input.sections[0].questions[0].references = [{ page }];
    assert.throws(() => renderSourceNote(input), /physical PDF page/);
  }
});

test('content that loses answer boundaries is rejected before any destination is created', async t => {
  const { parent } = await fixture(t);
  for (const answer of [
    'An answer.\n\n## Lost text\n\nMore.',
    'Heading\n=======\n\nLost text.',
    'An answer.\n\n**Q:** An accidental extra question?',
    'An answer.\n\n<!-- recall:id=123e4567-e89b-42d3-a456-426614174000 -->',
    '```python\nprint("unclosed")',
  ]) {
    const input = draft();
    input.sections[0].questions[0].answer = answer;
    await assert.rejects(writeSourceNote(input, parent, 'none'), /boundaries/);
    assert.deepEqual(await readdir(parent), []);
  }
});

test('new copies require confirmation, use fresh identities, and preserve old notes byte for byte', async t => {
  const { root, parent } = await fixture(t);
  const first = await writeSourceNote(draft(), parent, 'none');
  const original = await readFile(first.filePath, 'utf8');
  await assert.rejects(writeSourceNote(draft(), parent, 'none'), /Ask the user/);
  const second = await writeSourceNote(draft(), parent, 'confirmed-new-copy');
  assert.equal(path.basename(path.dirname(second.filePath)), 'A source (2)');
  assert.equal(await readFile(first.filePath, 'utf8'), original);
  const scan = await scanVault(root);
  assert.deepEqual(scan.diagnostics, []);
  assert.equal(scan.records.length, 2);
  assert.equal(new Set(scan.records.map(r => r.id)).size, 2);
});

test('prior-output declaration and an existing Recall collection are required', async t => {
  const { root, parent } = await fixture(t);
  await assert.rejects(writeSourceNote(draft(), parent, undefined), /Ask whether/);
  await assert.rejects(writeSourceNote(draft(), root, 'none'), /existing Recall collection/);
  assert.deepEqual(await readdir(parent), []);
});

test('concurrent confirmed copies reserve distinct folders without overwriting or partial Markdown', async t => {
  const { root, parent } = await fixture(t);
  const outputs = await Promise.all(Array.from({ length: 3 }, () => writeSourceNote(draft(), parent, 'confirmed-new-copy')));
  assert.equal(new Set(outputs.map(o => o.filePath)).size, 3);
  const scan = await scanVault(root);
  assert.deepEqual(scan.diagnostics, []);
  assert.equal(scan.records.length, 3);
});

test('an occupied source symlink is never followed or overwritten', async t => {
  const { root, parent } = await fixture(t);
  const outside = path.join(root, 'Existing notes');
  await mkdir(outside);
  await writeFile(path.join(outside, 'Keep.md'), 'Keep this.');
  await symlink(outside, path.join(parent, 'A source'));
  await assert.rejects(writeSourceNote(draft(), parent, 'none'), /Ask the user/);
  const copy = await writeSourceNote(draft(), parent, 'confirmed-new-copy');
  assert.equal(path.basename(path.dirname(copy.filePath)), 'A source (2)');
  assert.deepEqual(await readdir(outside), ['Keep.md']);
  assert.equal(await readFile(path.join(outside, 'Keep.md'), 'utf8'), 'Keep this.');
});

test('invalid drafts cannot introduce inherited identities, missing references, or escaped destinations', () => {
  const mutations = [
    d => { d.sections[0].questions[0].id = 'old-id'; },
    d => { d.sections[0].questions[0].references = []; },
    d => { d.sections[0].questions[0].prompt = 'First line\nsecond line'; },
    d => { d.sections[0].questions[0].references[0].url = 'javascript:alert(1)'; },
    d => { d.source.title = '..'; },
    d => { d.title = '_recall'; },
    d => { d.source.location = 'https://user:password@example.org/'; },
  ];
  for (const mutate of mutations) {
    const input = draft();
    mutate(input);
    assert.throws(() => renderSourceNote(input));
  }
  const input = draft();
  input.source.title = '../../Different folder';
  assert.ok(!renderSourceNote(input).folderName.includes('/'));
});

test('the CLI previews without writing, then creates the pilot note in one publication command', async t => {
  const { root, parent } = await fixture(t);
  const run = promisify(execFile);
  const cli = [path.resolve('node_modules/tsx/dist/cli.mjs'), path.join(__dirname, 'cli.ts')];
  const draftPath = path.join(__dirname, 'examples', 'spinning-up.json');
  const preview = await run(process.execPath, [...cli, '--draft', draftPath, '--preview']);
  assert.equal(parseRecallQuestions(preview.stdout).length, 5);
  assert.deepEqual(await readdir(parent), []);
  const saved = await run(process.execPath, [...cli, '--draft', draftPath, '--parent', parent, '--prior-output', 'none']);
  const result = JSON.parse(saved.stdout);
  assert.equal(result.questionCount, 5);
  assert.equal((await scanVault(root)).records.length, 5);
  await assert.rejects(run(process.execPath, [...cli, '--draft', draftPath, '--parent', parent]), /Ask whether/);
});
