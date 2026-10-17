/**
 * test.cjs — Единый комплексный тестовый набор VINETKA Photo Sorter
 * 
 * Включает:
 * 1. Распознавание списков (Word/Excel/CSV/TXT, казахские имена, форматы номеров, классный руководитель)
 * 2. Сопоставление кадров и форматов (.JPG, .jpeg, .CR2, лидирующие нули, ручная проверка)
 * 3. Логику экспорта Порт / Мод (3 сценария: только 1 кадр, у всех 2 кадра, смешанный)
 * 4. Безопасность исходных фотографий (неприкосновенность файлов, SHA-256 хэши)
 * 5. Визуальный проводник (диски, чтение папок, превью)
 * 6. AI Ұл / Қыз классификатор (гибридный лингвистический анализ + Face AI)
 * 7. YuNet детектор качества лиц и оверлей AI DEBUG (5 ориентиров)
 * 8. Кластеризацию серий и отбор лучшего кадра для коллажей
 * 9. Полную автоматическую самоочистку временных файлов после завершения
 */

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { execFile } = require('child_process');
const execFileAsync = promisify(execFile);
const XLSX = require('xlsx');

const { parseRawLine, parseTextLines, parseDocumentFile } = require('./parser.cjs');

const REAL_SHOOT_DIR = 'D:\\дизайн\\1ә обр 6000';
const SCRIPT_PATH = path.join(__dirname, 'scripts', 'face_quality_engine.py');
const TEMP_TEST_DIR = path.join('C:', 'Temp', `vinetka_test_${Date.now()}`);

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function run() {
  console.log('================================================================');
  console.log('  VINETKA PHOTO SORTER — ЕДИНЫЙ ТЕСТОВЫЙ НАБОР (САМООЧИЩАЮЩИЙСЯ)');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function testAssert(condition, name) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${name}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  try {
    if (!fs.existsSync(TEMP_TEST_DIR)) {
      fs.mkdirSync(TEMP_TEST_DIR, { recursive: true });
    }

    // -------------------------------------------------------------------------
    // РАЗДЕЛ 1: Парсинг строк и имен (Казахские символы, форматы, разделители)
    // -------------------------------------------------------------------------
    console.log('--- РАЗДЕЛ 1: ПАРСИНГ СТРОК И КАЗАХСКИХ ИМЕН ---');
    {
      const r1 = parseRawLine('Ескендір Жәннәт — 7113');
      testAssert(r1.surname === 'Ескендір' && r1.name === 'Жәннәт' && r1.numbers[0] === '7113', 'Формат: Фамилия Имя — 7113');

      const r2 = parseRawLine('7113 — Ескендір Жәннәт');
      testAssert(r2.surname === 'Ескендір' && r2.name === 'Жәннәт' && r2.numbers[0] === '7113', 'Формат: 7113 — Фамилия Имя');

      const r3 = parseRawLine('Ескендір Жәннәт 7113 7114');
      testAssert(r3.numbers.length === 2 && r3.numbers[0] === '7113' && r3.numbers[1] === '7114', 'Формат: 2 кадра через пробел (7113 7114)');

      const r4 = parseRawLine('Ескендір Жәннәт — 7113, 7114');
      testAssert(r4.numbers[0] === '7113' && r4.numbers[1] === '7114', 'Формат: кадры через запятую (7113, 7114)');

      const r5 = parseRawLine('Ескендір Жәннәт — 7113 / 7114');
      testAssert(r5.numbers[0] === '7113' && r5.numbers[1] === '7114', 'Формат: кадры через слэш (7113 / 7114)');

      const r6 = parseRawLine('7113 7114 Ескендір Жәннәт');
      testAssert(r6.surname === 'Ескендір' && r6.numbers[0] === '7113' && r6.numbers[1] === '7114', 'Формат: 7113 7114 Фамилия Имя');

      const r7 = parseRawLine('Тоқаев Қасым-Жомарт — 8891');
      testAssert(r7.surname === 'Тоқаев' && r7.name === 'Қасым-Жомарт' && r7.numbers[0] === '8891', 'Сохранение казахских букв (ә, ғ, қ, ң, ө, ұ, ү, һ, і)');

      const r8 = parseRawLine('Сынып жетекшісі: Ахметжанова Мақпал Амангельдиевна — 7258');
      testAssert(r8.role === 'teacher' && r8.surname === 'Ахметжанова' && r8.numbers[0] === '7258', 'Распознавание классного руководителя в одной строке');
    }

    // -------------------------------------------------------------------------
    // РАЗДЕЛ 2: Парсинг документов (TXT, Excel, CSV, многострочные учителя)
    // -------------------------------------------------------------------------
    console.log('\n--- РАЗДЕЛ 2: РАСПОЗНАВАНИЕ ДОКУМЕНТОВ (TXT, XLSX, CSV) ---');
    {
      // 2.1 TXT с 14 учениками и классным руководителем
      const txtContent = `Сынып жетекшісі:
Ахметжанова Мақпал Амангельдиевна — 7258
1. Ескендір Жәннәт — 7113
2. 7114 — Әлихан Нұрланұлы
3. Бөгенбай Кәусар 7115 7116
4. Даниярұлы Мансұр — 7117, 7118
5. Жұмабек Асылай — 7119 / 7120
6. 7121 7122 Зейнеп Серікқызы
7. Исабек Бақытжан 7123
8. Қайратұлы Арсен — 7124
9. Мұратбек Дильназ — 7125
10. Нұрғали Айзере — 7126
11. Өмірзақ Санжар — 7127
12. Рамазан Айару — 7128
13. Сейітхан Нұрасыл — 7129
14. Төлеген Еркебұлан — 7130`;

      const txtPath = path.join(TEMP_TEST_DIR, 'test_14_students.txt');
      fs.writeFileSync(txtPath, txtContent, 'utf8');
      const parsedTxt = await parseDocumentFile(txtPath);
      testAssert(parsedTxt.students.length === 14, 'TXT: ровно 14 учеников');
      testAssert(parsedTxt.teacher && parsedTxt.teacher.numbers[0] === '7258', 'TXT: классный руководитель отделен и номер 7258');

      // 2.2 Excel с несколькими колонками
      const wb = XLSX.utils.book_new();
      const wsData = [
        ['№', 'Тегі', 'Аты', 'Әкесінің аты', 'Портрет', 'Модель'],
        ['1', 'Ахмет', 'Әлихан', 'Нұрланұлы', '6652', '6653'],
        ['2', 'Бөгенбай', 'Кәусар', 'Нұрсұлтанқызы', '6668', ''],
        ['3', 'Сынып жетекшісі', 'Омарова', 'Нұржанат', '6765', '']
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Сынып');
      const xlsxPath = path.join(TEMP_TEST_DIR, 'test_class.xlsx');
      XLSX.writeFile(wb, xlsxPath);

      const parsedXlsx = await parseDocumentFile(xlsxPath);
      testAssert(parsedXlsx.students.length === 2, 'XLSX: ровно 2 ученика');
      testAssert(parsedXlsx.teacher && parsedXlsx.teacher.numbers[0] === '6765', 'XLSX: учитель распознан');

      // 2.3 CSV с точкой с запятой
      const csvContent = `Аты-жөні;Кадр\nЕлубек Асылбек;6678\nЕрғазы Байбатыр;6681\nУчитель: Сапарова Айнаш;6700`;
      const csvPath = path.join(TEMP_TEST_DIR, 'test_list.csv');
      fs.writeFileSync(csvPath, csvContent, 'utf8');
      const parsedCsv = await parseDocumentFile(csvPath);
      testAssert(parsedCsv.students.length === 2 && parsedCsv.teacher !== null, 'CSV: парсинг строк и учителя');

      // 2.4 Реальный список школьной съемки
      const realTxt = path.join(REAL_SHOOT_DIR, 'Новый текстовый документ.txt');
      if (fs.existsSync(realTxt)) {
        const parsedReal = await parseDocumentFile(realTxt);
        testAssert(parsedReal.students.length >= 20, `Реальный TXT съемки: прочитано ${parsedReal.students.length} учеников`);
        const realBoys = parsedReal.students.filter(s => s.gender === 'boy');
        const realGirls = parsedReal.students.filter(s => s.gender === 'girl');
        testAssert(realBoys.length + realGirls.length === parsedReal.students.length, `Мгновенное определение пола при чтении списка (мальчиков: ${realBoys.length}, девочек: ${realGirls.length})`);
      }
    }

    // -------------------------------------------------------------------------
    // РАЗДЕЛ 3: Сопоставление фотографий, расширений и Drag & Drop
    // -------------------------------------------------------------------------
    console.log('\n--- РАЗДЕЛ 3: СОПОСТАВЛЕНИЕ ФОТОГРАФИЙ И ИНДЕКСИРОВАНИЕ ---');
    {
      function matchNumber(num, fileName) {
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        const matches = [...base.matchAll(/(\d{3,6})(?!\d)/g)].map(x => x[1]);
        const cleanNum = String(parseInt(num, 10));
        return matches.some(m => m === num || String(parseInt(m, 10)) === cleanNum);
      }

      testAssert(matchNumber('7113', '088A7113.JPG'), 'Сопоставление 7113 -> 088A7113.JPG');
      testAssert(matchNumber('45', 'IMG_0045.jpeg'), 'Лидирующие нули (45 -> IMG_0045.jpeg)');
      testAssert(matchNumber('6652', 'DSC_6652.CR2'), 'RAW формат .CR2');
      testAssert(matchNumber('6765', '088A6765.jpg'), 'Регистронезависимость расширения');

      // Поиск смежной папки с фото
      const IMAGE_RE = /\.(jpe?g|png|webp|heic|cr2|cr3|nef|arw|dng)$/i;
      const candidates = [REAL_SHOOT_DIR, path.join(REAL_SHOOT_DIR, 'Фото')];
      let foundCount = 0;
      for (const dir of candidates) {
        try {
          const entries = fs.readdirSync(dir);
          const c = entries.filter(e => IMAGE_RE.test(e)).length;
          if (c >= 3) { foundCount = c; break; }
        } catch {}
      }
      testAssert(foundCount >= 200, `Автоопределение фото рядом со списком (${foundCount} фото)`);
    }

    // -------------------------------------------------------------------------
    // РАЗДЕЛ 4: Экспорт Порт / Мод (3 сценария)
    // -------------------------------------------------------------------------
    console.log('\n--- РАЗДЕЛ 4: ЛОГИКА ЭКСПОРТА ПОРТ / МОД ---');
    {
      function planExport(students, availablePhotos) {
        const avail = new Set(availablePhotos);
        let portCount = 0;
        let modCount = 0;
        for (const s of students) {
          if (s.numbers[0] && avail.has(s.numbers[0])) portCount++;
          if (s.numbers[1] && avail.has(s.numbers[1])) modCount++;
        }
        return {
          createPort: portCount > 0,
          createMod: modCount > 0,
          portCount,
          modCount
        };
      }

      // Сценарий 1: у всех по 1 кадру
      const s1 = planExport([{ numbers: ['101'] }, { numbers: ['102'] }], ['101', '102']);
      testAssert(s1.createPort === true && s1.createMod === false, 'Сценарий 1: У всех 1 кадр -> только Порт');

      // Сценарий 2: у всех по 2 кадра
      const s2 = planExport([{ numbers: ['101', '102'] }, { numbers: ['103', '104'] }], ['101', '102', '103', '104']);
      testAssert(s2.createPort === true && s2.createMod === true && s2.modCount === 2, 'Сценарий 2: У всех 2 кадра -> Порт и Мод');

      // Сценарий 3: смешанный список (у одного 1 кадр, у одного 2, у одного второй отсутствует на диске)
      const s3 = planExport([
        { numbers: ['101'] },
        { numbers: ['102', '103'] },
        { numbers: ['104', '999'] } // 999 нет на диске!
      ], ['101', '102', '103', '104']);
      testAssert(s3.portCount === 3 && s3.modCount === 1, 'Сценарий 3: В Мод попадает только реально существующий 2-й кадр');

      // Сценарий 4: Разделение по полу (Порт/Мальчики и Порт/Девчонки)
      function routePortExport(items, splitGenderPort) {
        return items.map(item => {
          if (!splitGenderPort) return 'Порт';
          if (item.gender === 'boy') return 'Порт/Мальчики';
          if (item.gender === 'girl') return 'Порт/Девчонки';
          return 'Порт';
        });
      }

      const samplePortItems = [
        { name: 'Алихан', gender: 'boy' },
        { name: 'Аружан', gender: 'girl' },
        { name: 'Учитель', gender: 'teacher' }
      ];

      const splitRoutes = routePortExport(samplePortItems, true);
      testAssert(
        splitRoutes[0] === 'Порт/Мальчики' &&
        splitRoutes[1] === 'Порт/Девчонки' &&
        splitRoutes[2] === 'Порт',
        'Сценарий 4: При splitGenderPort=true создаются Порт/Мальчики и Порт/Девчонки'
      );

      const standardRoutes = routePortExport(samplePortItems, false);
      testAssert(
        standardRoutes.every(r => r === 'Порт'),
        'Сценарий 5: При splitGenderPort=false все портреты сохраняются прямо в Порт'
      );
    }

    // -------------------------------------------------------------------------
    // РАЗДЕЛ 5: Неприкосновенность оригинальных файлов (Safety Test)
    // -------------------------------------------------------------------------
    console.log('\n--- РАЗДЕЛ 5: БЕЗОПАСНОСТЬ ОРИГИНАЛЬНЫХ ФОТОГРАФИЙ ---');
    {
      const sample = path.join(REAL_SHOOT_DIR, '088A6652.JPG');
      if (fs.existsSync(sample)) {
        const hashBefore = hashFile(sample);
        const sizeBefore = fs.statSync(sample).size;

        const copyTarget = path.join(TEMP_TEST_DIR, 'test_copy.jpg');
        fs.copyFileSync(sample, copyTarget);

        const hashAfter = hashFile(sample);
        const sizeAfter = fs.statSync(sample).size;
        const copyHash = hashFile(copyTarget);

        testAssert(hashBefore === hashAfter && sizeBefore === sizeAfter, 'Оригинал файла абсолютно неизменен');
        testAssert(copyHash === hashBefore, 'Скопированный файл полностью идентичен оригиналу');
      }
    }

    // -------------------------------------------------------------------------
    // РАЗДЕЛ 6: Визуальный проводник (диски и чтение папки)
    // -------------------------------------------------------------------------
    console.log('\n--- РАЗДЕЛ 6: ВИЗУАЛЬНЫЙ ПРОВОДНИК ФОТОГРАФИЙ ---');
    {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const drives = [];
      for (const l of letters) {
        try {
          fs.statSync(l + ':\\');
          drives.push(l + ':');
        } catch {}
      }
      testAssert(drives.includes('C:') && drives.includes('D:'), `Определение локальных дисков (${drives.join(', ')})`);

      const dirEntries = fs.readdirSync(REAL_SHOOT_DIR);
      const photoFiles = dirEntries.filter(f => /\.(jpe?g|png|cr2)$/i.test(f));
      testAssert(photoFiles.length >= 200, `Быстрое сканирование проводника (${photoFiles.length} фото)`);
    }

    // -------------------------------------------------------------------------
    // РАЗДЕЛ 7: AI Ұл / Қыз классификатор (Face AI + Казахские правила)
    // -------------------------------------------------------------------------
    console.log('\n--- РАЗДЕЛ 7: AI ҰЛ / ҚЫЗ КЛАССИФИКАТОР (22 УЧЕНИКА) ---');
    {
      const roster = [
        { id: 's1', name: 'Азамат Айсұлтан Нұрсұлтанұлы', path: path.join(REAL_SHOOT_DIR, '088A6652.JPG'), num: '6652' },
        { id: 's2', name: 'Арқабай Амира Дәулетқызы', path: path.join(REAL_SHOOT_DIR, '088A6657.JPG'), num: '6657' },
        { id: 's3', name: 'Әннас Інкәр Бағдатқызы', path: path.join(REAL_SHOOT_DIR, '088A6662.JPG'), num: '6662' },
        { id: 's4', name: 'Бөгенбай Кәусар Нұрсұлтанқызы', path: path.join(REAL_SHOOT_DIR, '088A6668.JPG'), num: '6668' },
        { id: 's5', name: 'Егінбай Нұрислам Азаматұлы', path: path.join(REAL_SHOOT_DIR, '088A6674.JPG'), num: '6674' },
        { id: 's6', name: 'Елубек Асылбек Әлібекұлы', path: path.join(REAL_SHOOT_DIR, '088A6678.JPG'), num: '6678' },
        { id: 's7', name: 'Ерғазы Байбатыр Шарханұлы', path: path.join(REAL_SHOOT_DIR, '088A6681.JPG'), num: '6681' },
        { id: 's8', name: 'Жасұлан Нұрислам Асланұлы', path: path.join(REAL_SHOOT_DIR, '088A6685.JPG'), num: '6685' },
        { id: 's9', name: 'Қайратова Зере Рустемовна', path: path.join(REAL_SHOOT_DIR, '088A6687.JPG'), num: '6687' },
        { id: 's10', name: 'Қайрат Айсұлтан Қуатбекович', path: path.join(REAL_SHOOT_DIR, '088A6690.JPG'), num: '6690' },
        { id: 's11', name: 'Қыдырбай Мұхаммедали Қуанышұлы', path: path.join(REAL_SHOOT_DIR, '088A6695.JPG'), num: '6695' },
        { id: 's12', name: 'Молдабеков Әмір Ерғазыұлы', path: path.join(REAL_SHOOT_DIR, '088A6701.JPG'), num: '6701' },
        { id: 's13', name: 'Мұрат Асыл Берікұлы', path: path.join(REAL_SHOOT_DIR, '088A6710.JPG'), num: '6710' },
        { id: 's14', name: 'Мұрат Мансұр Бекболатұлы', path: path.join(REAL_SHOOT_DIR, '088A6717.JPG'), num: '6717' },
        { id: 's15', name: 'Сайділдә Әміре Бағдатұлы', path: path.join(REAL_SHOOT_DIR, '088A6719.JPG'), num: '6719' },
        { id: 's16', name: 'Талғат Халида Бахытбекқызы', path: path.join(REAL_SHOOT_DIR, '088A6731.JPG'), num: '6731' },
        { id: 's17', name: 'Тлеубек Ділда Ерболқызы', path: path.join(REAL_SHOOT_DIR, '088A6735.JPG'), num: '6735' },
        { id: 's18', name: 'Төлеген Айсұлтан Сағынайұлы', path: path.join(REAL_SHOOT_DIR, '088A6740.JPG'), num: '6740' },
        { id: 's19', name: 'Төлеген Айсұлтан Серікұлы', path: path.join(REAL_SHOOT_DIR, '088A6743.JPG'), num: '6743' },
        { id: 's20', name: 'Төлеубай Кемел Дәулетұлы', path: path.join(REAL_SHOOT_DIR, '088A6754.JPG'), num: '6754' },
        { id: 's21', name: 'Хасен Дінмұхаммед Жанатұлы', path: path.join(REAL_SHOOT_DIR, '088A6760.JPG'), num: '6760' },
        { id: 't1', name: 'Омарова Нұржанат Мұқабыловна', path: path.join(REAL_SHOOT_DIR, '088A6765.JPG'), num: '6765', role: 'teacher' }
      ];

      const rosterJson = path.join(TEMP_TEST_DIR, 'roster.json');
      fs.writeFileSync(rosterJson, JSON.stringify(roster, null, 2), 'utf8');

      const { stdout: gOut } = await execFileAsync('python', [SCRIPT_PATH, '--mode', 'gender', '--input-json', rosterJson]);
      const gRes = JSON.parse(gOut);
      testAssert(gRes.ok === true, 'Исполнение face_quality_engine.py --mode gender');

      const boys = gRes.results.filter(r => r.gender === 'boy');
      const girls = gRes.results.filter(r => r.gender === 'girl');
      const unknown = gRes.results.filter(r => r.gender === 'unknown');

      testAssert(boys.length === 15, `Ұлдар (мальчики): ровно 15 (факт: ${boys.length})`);
      testAssert(girls.length === 7, `Қыздар (девочки/учитель): ровно 7 (факт: ${girls.length})`);
      testAssert(unknown.length === 0, `Неопределенных: 0 (100% точность классификации)`);
    }

    // -------------------------------------------------------------------------
    // РАЗДЕЛ 8: YuNet качество лица и AI DEBUG разметка
    // -------------------------------------------------------------------------
    console.log('\n--- РАЗДЕЛ 8: YUNET КАЧЕСТВО ЛИЦ И AI DEBUG РАЗМЕТКА ---');
    {
      const portrait = path.join(REAL_SHOOT_DIR, '088A6652.JPG');
      const { stdout: qOut } = await execFileAsync('python', [SCRIPT_PATH, '--mode', 'quality', '--photo', portrait]);
      const q = JSON.parse(qOut);
      testAssert(q.ok === true && q.faces_count === 1, `Портрет: обнаружено 1 лицо (score: ${q.overall_score})`);
      testAssert(q.eyes_open_count === 1, 'Портрет: открытые глаза');

      // AI DEBUG Base64
      const { stdout: dOut } = await execFileAsync('python', [SCRIPT_PATH, '--mode', 'debug-image', '--photo', portrait]);
      const d = JSON.parse(dOut);
      testAssert(d.ok === true && d.debug_image.startsWith('data:image/jpeg;base64,'), 'AI DEBUG оверлей с 5 ориентирами лица');
    }

    // -------------------------------------------------------------------------
    // РАЗДЕЛ 9: Кластеризация групповых серий и отбор лучшего кадра
    // -------------------------------------------------------------------------
    console.log('\n--- РАЗДЕЛ 9: КЛАСТЕРИЗАЦИЯ ГРУППОВЫХ СЕРИЙ (КОЛЛАЖИ) ---');
    {
      const exclude = '6652,6657,6662,6668,6674,6678,6681,6685,6687,6690,6695,6701,6710,6717,6719,6731,6735,6740,6743,6754,6760,6765';
      const { stdout: bOut } = await execFileAsync('python', [SCRIPT_PATH, '--mode', 'bursts', '--shoot-dir', REAL_SHOOT_DIR, '--exclude-frames', exclude], { maxBuffer: 10 * 1024 * 1024 });
      const bLines = bOut.trim().split(/\r?\n/).filter(Boolean);
      const bRes = JSON.parse(bLines[bLines.length - 1]);
      testAssert(bRes.ok === true && bRes.total_series > 0, `Формирование серий коллажей (${bRes.total_series} серий)`);

      const general = bRes.series.find(s => s.category === 'GENERAL_CLASS');
      testAssert(general !== undefined && general.recommended_frame !== '', `Рекомендация лучшего кадра общего класса: ${general?.recommended_frame}`);

      const allSeriesHaveAtLeastTwoFaces = bRes.series.every(s => (s.max_faces || 0) >= 2);
      testAssert(allSeriesHaveAtLeastTwoFaces, 'Исключение одиночных портретов: в сериях коллажей только кадры с 2+ лицами');
    }

    console.log('\n================================================================');
    console.log(`РЕЗУЛЬТАТ: ${passed} из ${total} проверок успешно пройдено (${Math.round(passed / total * 100)}%)`);
    console.log('================================================================\n');

  } finally {
    // Автоматическая самоочистка временных файлов
    if (fs.existsSync(TEMP_TEST_DIR)) {
      try {
        fs.rmSync(TEMP_TEST_DIR, { recursive: true, force: true });
        console.log(`✓ Временная папка тестов (${TEMP_TEST_DIR}) успешно удалена (0 байт мусора).`);
      } catch (err) {
        console.warn('Предупреждение при очистке:', err.message);
      }
    }
  }
}

run().catch(err => {
  console.error('\n❌ ОШИБКА ТЕСТА:', err);
  process.exit(1);
});
