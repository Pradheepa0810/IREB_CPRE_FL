import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import core from '../assets/quizzes/cpre-quiz-core.js';

const root = new URL('../', import.meta.url);
const path = relative => fileURLToPath(new URL(relative, root));
const questionBank = JSON.parse(fs.readFileSync(path('assets/quizzes/cpre-question-bank.json'), 'utf8'));

test('canonical question bank has seven chapters and five 45-question mocks', () => {
  assert.equal(core.validateBank(questionBank), true);
  assert.equal(questionBank.chapters.reduce((sum, chapter) => sum + chapter.questions.length, 0), 140);
  assert.equal(questionBank.mocks.reduce((sum, mock) => sum + mock.questions.length, 0), 225);
  assert.deepEqual(questionBank.mocks.map(mock => mock.questions.length), [45, 45, 45, 45, 45]);
});

test('all canonical answer keys earn full points under A/P/K scoring', () => {
  for (const question of [...questionBank.chapters, ...questionBank.mocks].flatMap(group => group.questions)) {
    assert.equal(core.scoreQuestion(question, question.correctAnswer), question.points, question.id);
  }
});

test('A, P, and K scoring retains partial-credit and over-selection rules', () => {
  const options = 'ABCDE'.split('').map(id => ({ id, text: `Option ${id}` }));
  const a = { id: 'A', type: 'A', points: 2, options, correctAnswer: ['B'] };
  const p = { id: 'P', type: 'P', points: 3, requiredCount: 3, options, correctAnswer: ['A', 'C', 'E'] };
  const k = { id: 'K', type: 'K', points: 2, statements: ['1', '2'].map(id => ({ id, text: `Statement ${id}` })), correctAnswer: { 1: true, 2: false } };
  assert.equal(core.scoreQuestion(a, ['B']), 2);
  assert.equal(core.scoreQuestion(p, ['A', 'C']), 2);
  assert.equal(core.scoreQuestion(p, ['A', 'C', 'E', 'B']), 0);
  assert.equal(core.scoreQuestion(k, { 1: true }), 1);
  assert.equal(core.scoreQuestion(k, { 1: true, 2: false }), 2);
});

test('single runtime bundle matches canonical JSON and contains built-in flashcards', () => {
  const result = spawnSync(process.execPath, [path('scripts/build-study-data.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path('assets/cpre-study-data.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.CPRE_QUESTION_BANK)), questionBank);
  const cards = JSON.parse(JSON.stringify(context.CPRE_EXTRA_FLASHCARDS));
  assert.equal(cards.count, 246);
  assert.deepEqual(Object.values(cards.byChapter).map(chapter => chapter.length), [27, 26, 71, 57, 22, 34, 9]);
});

test('consolidated legacy mock file contains sets 1–10 with 45 questions each', () => {
  const source = fs.readFileSync(path('assets/quizzes/cpre-fullmock-bank.txt'), 'utf8');
  const headers = [...source.matchAll(/^===== SET (\d+) \(75 MIN\).*?=====$/gm)];
  assert.deepEqual(headers.map(match => Number(match[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  headers.forEach((header, index) => {
    const body = source.slice(header.index + header[0].length, headers[index + 1]?.index ?? source.length);
    assert.equal([...body.matchAll(/^Q\d+\./gm)].length, 45, `Set ${header[1]}`);
  });
});

test('optional Andrew and Quizlet JSON pools remain valid and their figures resolve', () => {
  const andrew = JSON.parse(fs.readFileSync(path('assets/quizzes/andrew-quiz-translations.json'), 'utf8'));
  const quizlet = JSON.parse(fs.readFileSync(path('assets/quizzes/quizlet-question-bank.json'), 'utf8'));
  assert.equal(andrew.translatedQuestionCount, 374);
  assert.equal(quizlet.questions.length, 160);
  for (const question of quizlet.questions) {
    if (question.imageAsset) assert.ok(fs.existsSync(path(`assets/${question.imageAsset}`)), question.imageAsset);
  }
});

test('app uses one HTML entrypoint and organized assets', () => {
  const html = fs.readFileSync(path('cpre-study.html'), 'utf8');
  assert.match(html, /assets\/cpre-study-data\.js/);
  assert.match(html, /MOCK_BANK_FILES=\['quizzes\/cpre-fullmock-bank\.txt'\]/);
  assert.doesNotMatch(html, /cpre-question-bank\.js|cpre-extra-flashcards\.js/);
  assert.ok(fs.existsSync(path('assets/readme/dashboard-preview.svg')));
  assert.ok(fs.existsSync(path('assets/readme/case-study-preview.svg')));
  assert.ok(fs.existsSync(path('assets/readme/progress-preview.svg')));
  assert.ok(fs.existsSync(path('assets/flashcards/cpre-extra-flashcards.js')));
  assert.equal(fs.existsSync(path('index.html')), false);
  assert.equal(fs.existsSync(path('CPRE_Question_Bank.md')), false);
});
