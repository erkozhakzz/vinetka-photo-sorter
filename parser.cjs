/**
 * parser.cjs - Универсальный парсер списков для VINETKA Photo Sorter
 * Поддерживает: Word (.docx), Excel (.xlsx, .xls), CSV (.csv), TXT (.txt)
 * 
 * Особенности:
 * 1. 100% поддержка казахских букв: Ә, І, Ң, Ғ, Ү, Ұ, Қ, Ө, Һ, ә, і, ң, ғ, ү, ұ, қ, ө, һ
 * 2. Распознавание классного руководителя (Сынып жетекшісі / Классный руководитель / Учитель / Мұғалім)
 * 3. Любое расположение ФИО и номеров кадров:
 *    - "Ескендір Жәннәт — 7113"
 *    - "7113 — Ескендір Жәннәт"
 *    - "Ескендір Жәннәт 7113 7114"
 *    - "Ескендір Жәннәт — 7113, 7114"
 *    - "Ескендір Жәннәт — 7113 / 7114"
 *    - "7113 7114 Ескендір Жәннәт"
 *    - Разные столбцы в Excel / CSV
 *    - Двухстрочные записи учителя (маркер на одной строке, ФИО и кадр на следующей)
 *    - Нумерованные (1., №1, 1)) и ненумерованные строки
 */

const XLSX = require('xlsx');
const mammoth = require('mammoth');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

// Ключевые слова классного руководителя / учителя
const TEACHER_PATTERNS = [
  /сынып\s*жетекшісі/i,
  /сынып\s*жетекші/i,
  /жетекшісі/i,
  /классный\s*руководитель/i,
  /кл\.?\s*рук/i,
  /мұғалім/i,
  /мугалим/i,
  /учительница/i,
  /учитель/i,
  /тәрбиеші/i,
  /оқытушы/i,
  /куратор/i,
  /жетекши/i
];

// Служебные стоп-слова, которые не являются частью имени
const STOP_WORDS_RE = /\b(?:фото|фотосы|кадр|кадры|номер|номера|нөмірі|нөмірлері|таңдауы|выбрала|выбрал|выбор|photo|portrait|портрет|мод|порт)\b/gi;

// Буквенный шаблон имен (казахский + русский + латиница)
const NAME_CHARS_RE = /[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/;

function cleanString(s) {
  return String(s || '')
    .replace(/[_|;:,()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Проверяет, является ли строка маркером учителя
 */
function isTeacherMarker(text) {
  const t = String(text || '').trim();
  return TEACHER_PATTERNS.some(re => re.test(t));
}

/**
 * Извлекает все номера кадров из строки или набора ячеек.
 * Номера кадров обычно от 3 до 6 цифр (например, 7113, 088A7113 -> 7113).
 */
function extractFrameNumbers(text) {
  const s = String(text || '');
  const matches = [...s.matchAll(/(?:IMG|DSC|PHOTO|ФОТО|КАДР)?[_\-\s#№]*(\d{3,6})(?!\d)/gi)];
  const nums = [];
  for (const m of matches) {
    if (m[1] && !nums.includes(m[1])) {
      nums.push(m[1]);
    }
  }
  return nums;
}

/**
 * Извлекает компоненты ФИО из очищенного текста
 */
function extractNameTokens(text) {
  // Убираем нумерацию в начале строки: "1.", "1)", "№1", "1 "
  let cleaned = String(text || '')
    .replace(/^\s*(?:№\s*)?\d{1,3}\s*[.)\-–—:]\s*/u, ' ')
    .replace(STOP_WORDS_RE, ' ');

  // Убираем маркеры учителя, если они внутри строки
  for (const re of TEACHER_PATTERNS) {
    cleaned = cleaned.replace(re, ' ');
  }

  // Убираем все 3-6 значные числа (номера фото) и оставшиеся цифры
  cleaned = cleaned.replace(/(?:IMG|DSC|PHOTO|ФОТО|КАДР)?[_\-\s#№]*\d{3,6}(?:\.(?:jpe?g|png|heic|cr2|cr3|nef|arw|dng))?/gi, ' ');
  cleaned = cleaned.replace(/\b\d+\b/g, ' ');

  // Очищаем пунктуацию
  const tokens = cleanString(cleaned)
    .split(' ')
    .map(w => w.trim())
    .filter(w => w.length >= 2 && NAME_CHARS_RE.test(w));

  return tokens;
}

const TABLE_HEADER_WORDS = new Set([
  '№', 'n', 'п', 'р', 'т', 'тегі', 'аты', 'жөні', 'фамилия', 'имя', 'отчество', 'фио',
  'кадр', 'кадрлар', 'номер', 'номера', 'фото', 'фотолар', 'портрет', 'модель', 'мод', 'порт', 'пол', 'жынысы', 'класс', 'сынып'
]);

function isTableHeaderRow(tokens, numbers) {
  if (numbers && numbers.length > 0) return false;
  if (!tokens || tokens.length === 0) return true;
  return tokens.every(w => TABLE_HEADER_WORDS.has(w.toLowerCase()));
}

/**
 * Разбор одиночной строки текста в объект записи
 */
function parseRawLine(line, index = 0, defaultRole = 'student') {
  const raw = String(line || '').trim();
  if (raw.length < 3) return null;

  const isTeacher = defaultRole === 'teacher' || isTeacherMarker(raw);
  const numbers = extractFrameNumbers(raw);
  const nameTokens = extractNameTokens(raw);

  if (nameTokens.length === 0) return null;
  if (!isTeacher && isTableHeaderRow(nameTokens, numbers)) return null;

  const surname = nameTokens[0] || '';
  const firstName = nameTokens[1] || '';
  const patronymic = nameTokens.slice(2).join(' ') || '';
  const fullName = nameTokens.join(' ');

  return {
    id: `rec_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    index: index + 1,
    role: isTeacher ? 'teacher' : 'student',
    surname,
    name: firstName || surname, // если только 1 слово, используем его
    patronymic,
    fullName,
    numbers,
    gender: 'unknown',
    source: raw
  };
}

/**
 * Парсер массива строк (из TXT, DOCX или сконвертированного CSV)
 */
function parseTextLines(lines) {
  const students = [];
  const teachers = [];
  let pendingTeacherPrefix = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = String(lines[i] || '').trim();
    if (!rawLine) continue;

    // Проверяем отдельную строку маркера: "Сынып жетекшісі:"
    if (isTeacherMarker(rawLine)) {
      const numbersInLine = extractFrameNumbers(rawLine);
      const nameTokensInLine = extractNameTokens(rawLine);

      // Если в этой же строке есть имя — парсим сразу
      if (nameTokensInLine.length >= 1) {
        const rec = parseRawLine(rawLine, i, 'teacher');
        if (rec) teachers.push(rec);
        pendingTeacherPrefix = false;
        continue;
      } else {
        // Иначе имя учителя на следующей строке!
        pendingTeacherPrefix = true;
        continue;
      }
    }

    const currentRole = pendingTeacherPrefix ? 'teacher' : 'student';
    pendingTeacherPrefix = false;

    const rec = parseRawLine(rawLine, i, currentRole);
    if (!rec) continue;

    if (rec.role === 'teacher') {
      teachers.push(rec);
    } else {
      students.push(rec);
    }
  }

  return {
    students,
    teacher: teachers[0] || null,
    teachers,
    rawLinesCount: lines.length
  };
}

/**
 * Парсер листов Excel (XLSX, XLS) с поддержкой отдельных столбцов
 */
function parseWorkbook(workbook) {
  const allLines = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    for (const row of rows) {
      if (!Array.isArray(row) || !row.length) continue;

      // Объединяем ячейки строки через табуляцию / пробел
      const rowText = row
        .map(cell => String(cell || '').trim())
        .filter(Boolean)
        .join(' | ');

      if (rowText) allLines.push(rowText);
    }
  }

  return parseTextLines(allLines);
}

/**
 * Главная точка входа для разбора документа любого формата
 */
async function parseDocumentFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let result;

  if (['.xlsx', '.xls', '.csv'].includes(ext)) {
    const workbook = XLSX.readFile(filePath, { type: 'file', codepage: 65001 });
    result = parseWorkbook(workbook);
    result.format = ext.replace('.', '').toUpperCase();
  } else if (ext === '.docx') {
    const rawResult = await mammoth.extractRawText({ path: filePath });
    const lines = rawResult.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    result = parseTextLines(lines);
    result.format = 'DOCX';
  } else {
    // TXT или другие текстовые форматы
    const buffer = await readFile(filePath);
    // Пробуем UTF-8, при наличии невалидных последовательностей fallback на windows-1251
    let text = '';
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      text = decoder.decode(buffer);
    } catch {
      try {
        const decoder1251 = new TextDecoder('windows-1251');
        text = decoder1251.decode(buffer);
      } catch {
        text = buffer.toString('utf8');
      }
    }
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    result = parseTextLines(lines);
    result.format = 'TXT';
  }

  result.fileName = path.basename(filePath);
  result.filePath = filePath;
  result.directory = path.dirname(filePath);

  return result;
}

module.exports = {
  parseDocumentFile,
  parseRawLine,
  parseTextLines,
  extractFrameNumbers,
  extractNameTokens,
  isTeacherMarker
};
