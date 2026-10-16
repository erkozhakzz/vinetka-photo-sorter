const assert = require('node:assert');
const { parseRawLine, parseTextLines, isTeacherMarker } = require('./parser.cjs');

console.log('--- Testing parser.cjs ---');

// Test 1: Standard Name - Number
{
  const r = parseRawLine('Ескендір Жәннәт — 7113');
  assert.strictEqual(r.surname, 'Ескендір');
  assert.strictEqual(r.name, 'Жәннәт');
  assert.deepStrictEqual(r.numbers, ['7113']);
  assert.strictEqual(r.role, 'student');
  console.log('✓ Test 1 passed: Ескендір Жәннәт — 7113');
}

// Test 2: Number - Name
{
  const r = parseRawLine('7113 — Ескендір Жәннәт');
  assert.strictEqual(r.surname, 'Ескендір');
  assert.strictEqual(r.name, 'Жәннәт');
  assert.deepStrictEqual(r.numbers, ['7113']);
  assert.strictEqual(r.role, 'student');
  console.log('✓ Test 2 passed: 7113 — Ескендір Жәннәт');
}

// Test 3: Name with 2 numbers space separated
{
  const r = parseRawLine('Ескендір Жәннәт 7113 7114');
  assert.strictEqual(r.surname, 'Ескендір');
  assert.strictEqual(r.name, 'Жәннәт');
  assert.deepStrictEqual(r.numbers, ['7113', '7114']);
  console.log('✓ Test 3 passed: Ескендір Жәннәт 7113 7114');
}

// Test 4: Name with comma separated numbers
{
  const r = parseRawLine('Ескендір Жәннәт — 7113, 7114');
  assert.deepStrictEqual(r.numbers, ['7113', '7114']);
  console.log('✓ Test 4 passed: Ескендір Жәннәт — 7113, 7114');
}

// Test 5: Name with slash separated numbers
{
  const r = parseRawLine('Ескендір Жәннәт — 7113 / 7114');
  assert.deepStrictEqual(r.numbers, ['7113', '7114']);
  console.log('✓ Test 5 passed: Ескендір Жәннәт — 7113 / 7114');
}

// Test 6: Numbers first, then Name
{
  const r = parseRawLine('7113 7114 Ескендір Жәннәт');
  assert.strictEqual(r.surname, 'Ескендір');
  assert.strictEqual(r.name, 'Жәннәт');
  assert.deepStrictEqual(r.numbers, ['7113', '7114']);
  console.log('✓ Test 6 passed: 7113 7114 Ескендір Жәннәт');
}

// Test 7: Kazakh characters preservation
{
  const r = parseRawLine('Тоқаев Қасым-Жомарт — 8891');
  assert.strictEqual(r.surname, 'Тоқаев');
  assert.strictEqual(r.name, 'Қасым-Жомарт');
  assert.deepStrictEqual(r.numbers, ['8891']);
  console.log('✓ Test 7 passed: Kazakh letters preserved');
}

// Test 8: Single-line teacher detection
{
  const r = parseRawLine('Сынып жетекшісі: Ахметжанова Мақпал Амангельдиевна — 7258');
  assert.strictEqual(r.role, 'teacher');
  assert.strictEqual(r.surname, 'Ахметжанова');
  assert.strictEqual(r.name, 'Мақпал');
  assert.strictEqual(r.patronymic, 'Амангельдиевна');
  assert.deepStrictEqual(r.numbers, ['7258']);
  console.log('✓ Test 8 passed: Single-line teacher');
}

// Test 9: Multi-line teacher detection in full list
{
  const lines = [
    'Сынып жетекшісі:',
    'Ахметжанова Мақпал Амангельдиевна — 7258',
    '1. Ескендір Жәннәт — 7113',
    '2. Нұрлан Айдос — 7114, 7115',
    '3. 7116 — Серік Әлихан'
  ];
  const parsed = parseTextLines(lines);
  assert.ok(parsed.teacher, 'Teacher should be found');
  assert.strictEqual(parsed.teacher.surname, 'Ахметжанова');
  assert.strictEqual(parsed.teacher.role, 'teacher');
  assert.deepStrictEqual(parsed.teacher.numbers, ['7258']);
  assert.strictEqual(parsed.students.length, 3);
  assert.strictEqual(parsed.students[0].surname, 'Ескендір');
  assert.deepStrictEqual(parsed.students[1].numbers, ['7114', '7115']);
  assert.strictEqual(parsed.students[2].surname, 'Серік');
  console.log('✓ Test 9 passed: Multi-line teacher and student list');
}

console.log('ALL PARSER TESTS PASSED SUCCESSFULLY! 🎉');
