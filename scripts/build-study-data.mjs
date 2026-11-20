import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import core from '../assets/quizzes/cpre-quiz-core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const quizBankPath = path.join(root, 'assets', 'quizzes', 'cpre-question-bank.json');
const flashcardSourcePath = path.join(root, 'assets', 'flashcards', 'cpre-extra-flashcards.js');
const outputPath = path.join(root, 'assets', 'cpre-study-data.js');

const questionBank = JSON.parse(fs.readFileSync(quizBankPath, 'utf8'));
core.validateBank(questionBank);
const questionScript = `// Canonical CPRE question bank.\nglobalThis.CPRE_QUESTION_BANK = ${JSON.stringify(questionBank)};`;
const flashcardScript = fs.readFileSync(flashcardSourcePath, 'utf8').replace(/\r\n?/g, '\n').trim();
const bundle = [
  '// Generated runtime bundle from assets/quizzes/cpre-question-bank.json and assets/flashcards/cpre-extra-flashcards.js; do not edit.',
  questionScript,
  flashcardScript
].join('\n\n') + '\n';

const platformBundle = process.platform === 'win32' ? bundle.replace(/\n/g, '\r\n') : bundle;
fs.writeFileSync(outputPath, platformBundle, 'utf8');
console.log(`Built ${path.relative(root, outputPath)} with ${questionBank.chapters.reduce((sum, chapter) => sum + chapter.questions.length, 0)} chapter questions and ${questionBank.mocks.reduce((sum, mock) => sum + mock.questions.length, 0)} canonical mock questions.`);
