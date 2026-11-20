(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CPREQuizCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function sum(values) {
    var total = 0, correction = 0;
    values.forEach(function (value) {
      var adjusted = value - correction;
      var next = total + adjusted;
      correction = (next - total) - adjusted;
      total = next;
    });
    return total;
  }

  function close(a, b) {
    return Math.abs(a - b) <= 16 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
  }

  function referencePrefixes(reference) {
    var matches = String(reference || '').match(/\bEU\s*[1-7](?:\.\d+)+\b/g) || [];
    return Array.from(new Set(matches.map(function (prefix) { return prefix.replace(/\s+/g, ''); })));
  }

  // Throws an aggregate diagnostic; returns true only for a complete valid bank.
  function validateBank(bank) {
    var errors = [], seen = new Set();
    function check(condition, message) { if (!condition) errors.push(message); }
    function text(value) { return typeof value === 'string' && value.trim().length > 0; }
    check(bank && bank.schemaVersion === 1, 'schemaVersion must be 1');
    var chapters = bank && Array.isArray(bank.chapters) ? bank.chapters : [];
    var mocks = bank && Array.isArray(bank.mocks) ? bank.mocks : [];
    check(chapters.length === 7, 'Expected 7 chapters');
    check(mocks.length === 5, 'Expected 5 mocks');
    [chapters, mocks].forEach(function (groups, kind) {
      groups.forEach(function (group, index) {
        var expectedId = (kind ? 'M' : 'EU') + (index + 1);
        check(group && group.id === expectedId && group.number === index + 1, expectedId + ': invalid group identity/order');
        if (!group) return;
        check(text(group.title), expectedId + ': empty title');
        var questions = Array.isArray(group.questions) ? group.questions : [];
        var count = kind ? 45 : [8, 12, 55, 35, 10, 16, 4][index];
        check(questions.length === count, expectedId + ': expected ' + count + ' questions, got ' + questions.length);
        if (kind) {
          check(group.durationMinutes === 75, expectedId + ': durationMinutes must be 75');
          check(group.passMark === 70, expectedId + ': passMark must be 70');
          var points = sum(questions.map(function (q) { return q && q.points; }));
          check(Number.isFinite(group.totalPoints) && group.totalPoints === points,
            expectedId + ': totalPoints declares ' + group.totalPoints + ' but headers sum to ' + points);
        }
        questions.forEach(function (q) {
          if (!q || typeof q !== 'object') { errors.push(expectedId + ': invalid question'); return; }
          var label = q.id || expectedId;
          check(typeof q.id === 'string' && (kind ? /^M[1-5]-Q\d{2}$/ : /^EU[1-7][ab]?-Q\d{2}$/).test(q.id), label + ': invalid stable ID');
          check(typeof q.id === 'string' && q.id.split('-')[0].replace(/[ab]$/, '') === expectedId, label + ': wrong group');
          check(!seen.has(q.id), label + ': duplicate global ID'); seen.add(q.id);
          check(['A', 'P', 'K'].includes(q.type), label + ': invalid type');
          check(Number.isInteger(q.points) && q.points >= 1 && q.points <= 3, label + ': points must be 1–3');
          check(text(q.prompt), label + ': empty prompt');
          check(text(q.explanation), label + ': empty explanation');
          check(text(q.reference) && referencePrefixes(q.reference).length > 0, label + ': invalid/empty reference');
          var items = q.type === 'K' ? q.statements : q.options;
          if (!Array.isArray(items)) { errors.push(label + ': missing options/statements'); return; }
          // Source P blocks legitimately have up to seven options; do not truncate them.
          check(items.length >= 4 && items.length <= (q.type === 'K' ? 5 : 7), label + ': invalid item count');
          items.forEach(function (item, i) {
            check(item && item.id === (q.type === 'K' ? String(i + 1) : String.fromCharCode(65 + i)) && text(item.text), label + ': invalid item ' + (i + 1));
          });
          if (q.type === 'K') {
            check(q.options === undefined && q.requiredCount === undefined, label + ': invalid K parameters');
            var key = q.correctAnswer;
            check(key && typeof key === 'object' && !Array.isArray(key) && Object.keys(key).length === items.length && items.every(function (s) { return s && Object.hasOwn(key, s.id) && typeof key[s.id] === 'boolean'; }), label + ': invalid K answer key');
          } else {
            check(q.statements === undefined, label + ': invalid choice parameters');
            var required = q.type === 'A' ? 1 : q.requiredCount;
            check(q.type === 'A' ? q.requiredCount === undefined : Number.isInteger(required) && required >= 2 && required <= items.length, label + ': invalid requiredCount');
            check(Array.isArray(q.correctAnswer) && q.correctAnswer.length === required && new Set(q.correctAnswer).size === required && q.correctAnswer.every(function (letter) { return items.some(function (o) { return o && o.id === letter; }); }), label + ': invalid choice answer key');
          }
        });
      });
    });
    if (errors.length) throw new Error('Invalid question bank:\n' + errors.join('\n'));
    return true;
  }

  // Returns earned points, not a percentage. Unknown/invalid selections earn nothing.
  function scoreQuestion(question, answer) {
    if (question.type === 'K') {
      var key = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
      var correct = question.statements.filter(function (s) {
        return Object.hasOwn(key, s.id) && typeof key[s.id] === 'boolean' && key[s.id] === question.correctAnswer[s.id];
      }).length;
      return question.points * correct / question.statements.length;
    }
    if (!Array.isArray(answer)) return 0;
    var required = question.type === 'A' ? 1 : question.requiredCount;
    if (answer.length > required || new Set(answer).size !== answer.length || answer.some(function (id) { return !question.options.some(function (o) { return o.id === id; }); })) return 0;
    var matches = answer.filter(function (id) { return question.correctAnswer.includes(id); }).length;
    return question.points * matches / required;
  }

  // answers is a plain object keyed by stable question ID; missing keys are unanswered.
  function scoreAttempt(questions, answers) {
    var results = questions.map(function (q) {
      var earned = scoreQuestion(q, answers && Object.hasOwn(answers, q.id) ? answers[q.id] : undefined);
      return { questionId: q.id, earned: earned, possible: q.points, fullyCorrect: close(earned, q.points), reference: q.reference };
    });
    var rawPoints = sum(results.map(function (r) { return r.earned; }));
    var totalPoints = sum(results.map(function (r) { return r.possible; }));
    var threshold = totalPoints * 0.7;
    return { rawPoints: rawPoints, totalPoints: totalPoints, percentage: totalPoints ? rawPoints / totalPoints * 100 : 0,
      passed: totalPoints > 0 && (rawPoints >= threshold || close(rawPoints, threshold)), results: results };
  }

  return { validateBank: validateBank, scoreQuestion: scoreQuestion, scoreAttempt: scoreAttempt, referencePrefixes: referencePrefixes };
});