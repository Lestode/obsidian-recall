const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile, symlink } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { renderSourceNote, writeSourceNote, renderSourceNotes, writeSourceNotes, appendSourceNotes } = require('./prepare.ts');
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
  assert.equal(note.split('\n**A:** ').length - 1, 2);
  assert.deepEqual(await readdir(path.dirname(result.filePath)), ['Core concepts.md']);
});

test('answer labels do not change indexed identities or content versions', async t => {
  const { root, parent } = await fixture(t);
  const input = draft();
  input.sections[0].questions.push({ ...input.sections[0].questions[0], prompt: 'In the lesson, how is the constant used?' });
  const result = await writeSourceNote(input, parent, 'none');
  const labelled = await scanVault(root);
  const markdown = await readFile(result.filePath, 'utf8');
  await writeFile(result.filePath, markdown.replaceAll('\n**A:** ', '\n'));
  const unlabelled = await scanVault(root);
  assert.deepEqual(labelled.diagnostics, []);
  assert.deepEqual(unlabelled.diagnostics, []);
  const stableContent = records => records.map(({ sourceLine, ...record }) => record);
  assert.deepEqual(stableContent(labelled.records), stableContent(unlabelled.records));
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

test('the inspector maps local PDF sources to the indexed question while retaining physical pages', async () => {
  const { inspectorSourceLink } = await import('../../apps/review-web/src/source-links.js');
  const href = 'file:///tmp/A%20source%20%C3%BC.pdf#page=3';
  const result = new URL(inspectorSourceLink(href, 'question-id'), 'http://127.0.0.1');
  assert.equal(result.pathname, '/api/questions/question-id/source-pdf');
  assert.equal(result.searchParams.get('source'), 'file:///tmp/A%20source%20%C3%BC.pdf');
  assert.equal(result.hash, '#page=3');
  for (const unchanged of [
    'https://example.org/source.pdf#page=3', 'https://example.org/lesson#definition',
    'file:///tmp/notes.txt', 'file://remote/Share/source.pdf', 'javascript:alert(1)',
  ]) {
    assert.equal(inspectorSourceLink(unchanged, 'question-id'), unchanged);
  }
  assert.equal(inspectorSourceLink(href), href);
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

function bookDraft() {
  const input = draft();
  return { source: { ...input.source, scope: 'All chapters and appendices' }, notes: [
    { title: 'Introduction', scope: 'Chapter 1', sections: input.sections },
    { title: 'Second chapter', sections: input.sections },
    { title: 'Notation', path: 'Appendices/01 Notation.md', sections: input.sections },
  ] };
}

test('one book run creates ordered chapter notes and appendices with independent fresh identities', async t => {
  const { root, parent } = await fixture(t);
  const input = bookDraft();
  const result = await writeSourceNotes(input, parent, 'none');
  assert.equal(result.questionCount, 3);
  assert.deepEqual(result.notes.map(note => path.relative(result.folderPath, note.filePath)), [
    '01 Introduction.md', '02 Second chapter.md', 'Appendices/01 Notation.md',
  ]);
  const scan = await scanVault(root);
  assert.deepEqual(scan.diagnostics, []);
  assert.equal(scan.records.length, 3);
  assert.equal(new Set(scan.records.map(record => record.id)).size, 3);
  const original = await readFile(result.notes[0].filePath, 'utf8');
  assert.match(original, /Scope: Chapter 1/);
  assert.match(await readFile(result.notes[1].filePath, 'utf8'), /Scope: All chapters and appendices/);
  await assert.rejects(writeSourceNotes(input, parent, 'none'), /Ask the user/);
  const copy = await writeSourceNotes(input, parent, 'confirmed-new-copy');
  assert.match(copy.folderPath, /A source \(2\)$/);
  assert.equal(await readFile(result.notes[0].filePath, 'utf8'), original);
  assert.equal(new Set((await scanVault(root)).records.map(record => record.id)).size, 6);
});

test('every chapter is validated before the source folder is created', async t => {
  const { parent } = await fixture(t);
  const input = bookDraft();
  input.notes[2].sections = [{ title: 'Broken', questions: [{
    ...draft().sections[0].questions[0], answer: 'Answer.\n\n## Unexpected boundary\n\nLost content.',
  }] }];
  await assert.rejects(writeSourceNotes(input, parent, 'none'), /boundaries/);
  assert.deepEqual(await readdir(parent), []);
});

test('book note paths reject traversal, reserved files, collisions and ambiguous draft formats', () => {
  for (const notePath of ['../escape.md', '/absolute.md', 'chapter\\escape.md', '.hidden/note.md', '_recall.md', 'node_modules/note.md', 'Chapter/../note.md']) {
    const input = bookDraft();
    input.notes[0].path = notePath;
    assert.throws(() => renderSourceNotes(input));
  }
  for (const paths of [
    ['Chapter.md', 'chapter.md'], ['Chapter.md', 'chapter.md/section.md'],
    ['Café.md', 'Cafe\u0301.md'], ['Appendices/a.md', 'appendices/b.md'],
  ]) {
    const input = bookDraft();
    input.notes[0].path = paths[0]; input.notes[1].path = paths[1];
    assert.throws(() => renderSourceNotes(input), /paths/);
  }
  assert.throws(() => renderSourceNotes({ ...bookDraft(), title: 'Ambiguous' }), /mix/);
  assert.throws(() => renderSourceNotes({ ...bookDraft(), notes: [] }), /nonempty/);
});

test('a filesystem publication failure reports incomplete output and cleans up unchanged generated files', async t => {
  const { parent } = await fixture(t);
  const input = bookDraft();
  input.notes[1].path = 'x'.repeat(300) + '.md';
  await assert.rejects(writeSourceNotes(input, parent, 'none'), /preparation is incomplete/);
  assert.deepEqual(await readdir(parent), []);
});

test('multi-note CLI preview and publication keep note boundaries and question counts', async t => {
  const { root, parent } = await fixture(t);
  const run = promisify(execFile);
  const cli = [path.resolve('node_modules/tsx/dist/cli.mjs'), path.join(__dirname, 'cli.ts')];
  const draftPath = path.join(root, 'book.json');
  await writeFile(draftPath, JSON.stringify(bookDraft()));
  const preview = JSON.parse((await run(process.execPath, [...cli, '--draft', draftPath, '--preview'])).stdout);
  assert.equal(preview.notes.length, 3);
  assert.equal(preview.questionCount, 3);
  assert.deepEqual(await readdir(parent), []);
  const output = JSON.parse((await run(process.execPath, [...cli, '--draft', draftPath, '--parent', parent, '--prior-output', 'none'])).stdout);
  assert.equal(output.notes.length, 3);
  assert.equal(output.questionCount, 3);
  assert.equal((await scanVault(root)).records.length, 3);
});

test('staged continuation adds chapters with fresh IDs and preserves all published content', async t => {
  const { root, parent } = await fixture(t);
  const initial = bookDraft();
  initial.notes = initial.notes.slice(0, 1);
  const first = await writeSourceNotes(initial, parent, 'none');
  const original = await readFile(first.notes[0].filePath, 'utf8');
  const continuation = bookDraft();
  continuation.notes = continuation.notes.slice(1);
  continuation.notes[0].path = '02 Second chapter.md';
  const appended = await appendSourceNotes(continuation, first.folderPath);
  assert.equal(appended.folderPath, first.folderPath);
  assert.equal(appended.questionCount, 2);
  assert.equal(await readFile(first.notes[0].filePath, 'utf8'), original);
  const scan = await scanVault(root);
  assert.deepEqual(scan.diagnostics, []);
  assert.equal(scan.records.length, 3);
  assert.equal(new Set(scan.records.map(record => record.id)).size, 3);
  const another = bookDraft();
  another.notes = [another.notes[2]];
  another.notes[0].path = 'Appendices/02 Extra.md';
  await appendSourceNotes(another, first.folderPath);
  assert.equal((await scanVault(root)).records.length, 4);
});

test('continuation preflights occupied, case-variant, and symlink paths before adding any file', async t => {
  const { root, parent } = await fixture(t);
  const first = await writeSourceNotes(bookDraft(), parent, 'none');
  const input = bookDraft();
  input.notes[0].path = '04 New chapter.md';
  input.notes[1].path = '01 Introduction.md';
  await assert.rejects(appendSourceNotes(input, first.folderPath), /absent note paths/);
  await assert.rejects(readFile(path.join(first.folderPath, '04 New chapter.md')), { code: 'ENOENT' });
  input.notes = [input.notes[0]];
  input.notes[0].path = 'appendices/02 Extra.md';
  await assert.rejects(appendSourceNotes(input, first.folderPath), /spelling/);
  const outside = path.join(root, 'Outside');
  await mkdir(outside);
  await symlink(outside, path.join(first.folderPath, 'Linked'));
  input.notes[0].path = 'Linked/Extra.md';
  await assert.rejects(appendSourceNotes(input, first.folderPath), /symlink/);
  assert.deepEqual(await readdir(outside), []);
  await assert.rejects(appendSourceNotes(input, path.join(first.folderPath, 'Linked')), /symlink/);
});

test('failed continuation removes only its own unchanged files and new directories', async t => {
  const { parent } = await fixture(t);
  const first = await writeSourceNotes(bookDraft(), parent, 'none');
  const before = await readdir(first.folderPath);
  const original = await readFile(first.notes[0].filePath, 'utf8');
  const input = bookDraft();
  input.notes[0].path = 'Appendices/02 Extra.md';
  input.notes[1].path = 'New directory/03 New.md';
  input.notes[2].path = 'x'.repeat(300) + '.md';
  await assert.rejects(appendSourceNotes(input, first.folderPath), /incomplete/);
  assert.deepEqual(await readdir(first.folderPath), before);
  assert.deepEqual(await readdir(path.join(first.folderPath, 'Appendices')), ['01 Notation.md']);
  assert.equal(await readFile(first.notes[0].filePath, 'utf8'), original);
});

test('CLI continuation accepts an existing source folder and refuses conflicting destination modes', async t => {
  const { root, parent } = await fixture(t);
  const first = await writeSourceNotes(bookDraft(), parent, 'none');
  const input = bookDraft();
  input.notes = [input.notes[0]];
  input.notes[0].path = '04 New.md';
  const draftPath = path.join(root, 'next.json');
  await writeFile(draftPath, JSON.stringify(input));
  const run = promisify(execFile);
  const cli = [path.resolve('node_modules/tsx/dist/cli.mjs'), path.join(__dirname, 'cli.ts'), '--draft', draftPath];
  await assert.rejects(run(process.execPath, [...cli, '--append-to', first.folderPath, '--parent', parent]), /cannot be combined/);
  const result = JSON.parse((await run(process.execPath, [...cli, '--append-to', first.folderPath])).stdout);
  assert.equal(result.questionCount, 1);
  assert.equal((await scanVault(root)).records.length, 4);
});
