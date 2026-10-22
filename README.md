# 📸 VINETKA Photo Sorter v2.3.0 (Commercial Release)

[![Release](https://img.shields.io/badge/Release-v2.3.0-orange.svg)](https://github.com/erkozhakzz/vinetka-photo-sorter/releases/tag/v2.3.0)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11%20%7C%20macOS-blue.svg)](https://erkozhakzz.github.io/vinetka-photo-sorter/download.html)
[![License](https://img.shields.io/badge/License-Commercial-green.svg)](https://t.me/vinetka_keys_kz_bot)
[![Tests](https://img.shields.io/badge/Tests-42%2F42%20PASS-brightgreen.svg)](test.cjs)

Официальное настольное приложение для фотографов и студии **VINETKA.KZ** для интеллектуальной автоматической сортировки школьных, детсадовских и выпускных съёмок, отбора лучших дублей общих коллажей (ИИ-контроль открытых глаз) и мгновенного импорта списков.

---

## 🌐 Официальный сайт и скачивание в 1 клик

- **Сайт и загрузка:** [https://erkozhakzz.github.io/vinetka-photo-sorter/download.html](https://erkozhakzz.github.io/vinetka-photo-sorter/download.html)
- **Зеркало главной страницы:** [https://erkozhakzz.github.io/vinetka-photo-sorter/](https://erkozhakzz.github.io/vinetka-photo-sorter/)
- **Прямой установщик Windows (x64, .exe):** [Скачать VINETKA-Photo-Sorter-Setup-2.3.0.exe](https://github.com/erkozhakzz/vinetka-photo-sorter/releases/download/v2.3.0/VINETKA-Photo-Sorter-Setup-2.3.0.exe) (~150 МБ)
- **Прямой пакет macOS Apple Silicon (M1/M2/M3/M4, .zip):** [Скачать VINETKA-Photo-Sorter-macOS-arm64.zip](https://github.com/erkozhakzz/vinetka-photo-sorter/releases/download/v2.3.0/VINETKA-Photo-Sorter-macOS-arm64.zip) (~111 МБ)
- **Лицензионный Telegram-бот:** [@vinetka_keys_kz_bot](https://t.me/vinetka_keys_kz_bot)

---

## 🚀 Ключевые возможности

### 1. ⚡ Сверхбыстрый запуск и производительность
- Время холодного старта окна: **0.42 секунды** благодаря ленивой подгрузке тяжелых библиотек (`xlsx`, `mammoth`) и аппаратной GPU-растеризации Chromium.
- Защита от дублирующих процессов (Single Instance Lock).

### 2. 👁️ Умный ИИ отбор коллажей и общего фото
- Автоматическая группировка серий снимков по временным интервалам съемки.
- Определение лучшего общего кадра класса (`GENERAL_CLASS`), групп мальчиков (`BOYS_GROUP`) и мини-коллажей (`SMALL_GROUP`).
- Нейросетевой контроль открытых глаз (YuNet 5 landmarks) и резкости каждого лица в кадре. Выбирается снимок со 100% открытыми глазами всех учеников.
- Корректный экспорт с префиксами: `Общий_класс_01_...`, `Мальчики_02_...`, `Коллаж_03_...`.

### 3. 👦👧 Разделение мальчиков и девочек в «ПОРТ»
- Встроенный чекбокс: **«Сохранить отдельно мальчики или девчонки»** / **«Ұлдар мен қыздарды бөлек сақтау»**.
- При включении: внутри папки `Порт` создаются подкаталоги `Мальчики` и `Девчонки`.
- Автоматическая классификация пола на основе базы казахских и международных имён + нейросетевая модель `genderage.onnx`.

### 4. 📋 Прямая вставка списка (Ctrl+V)
- Списки учеников можно копировать напрямую из WhatsApp, Telegram или заметок и нажимать **Ctrl+V** в программе — файл создавать не обязательно!
- Поддержка форматов файлов: Microsoft Word (`.docx`), Excel (`.xlsx`, `.xls`), `.csv`, `.txt`.
- 100% поддержка казахских букв (`ә, ғ, қ, ң, ө, ұ, ү, һ, і`).
- Автоматическое отделение классного руководителя и учителей.

### 5. 🔒 Абсолютная безопасность оригиналов
- Исходные RAW/JPG фотографии только считываются и никогда не перезаписываются и не удаляются.
- Полная локальная обработка данных без передачи конфиденциальных детских фотографий в облако.

---

## 💼 Лицензирование и продажа

Лицензионная система построена на криптографических ключах формата `VK-XXXX-XXXX-XXXX-XXXX` с привязкой к оборудованию:
1. **Пробный режим**: доступен ознакомительный запуск на 1 класс.
2. **Сезонный безлимит (2026–2027)**: неограниченная сортировка портретов и коллажей для школьных фотографов и студий.
3. **Покупка и мгновенная активация**: через официального бота [@vinetka_keys_kz_bot](https://t.me/vinetka_keys_kz_bot).

---

## 📁 Структура проекта

```
vinetka-photo-sorter/
├── index.html                  # Главный интерфейс приложения (v2.3.0)
├── license.html                # Окно первичной активации лицензии
├── main.cjs                    # Основной процесс Electron (IPC, проводник, экспорт)
├── preload.cjs                 # Защищенный мост API (Context Isolation)
├── parser.cjs                  # Оптимизированный ленивый движок парсинга
├── build-asar.cjs              # Сборщик чистого продакшн app.asar
├── installer.iss               # Скрипт компилятора Inno Setup 6
├── test.cjs                    # Комплексный автоматический тест (42 теста, 100% pass)
├── download.html               # Страница загрузки в 1 клик и витрина тарифов
├── docs/                       # Источник GitHub Pages (erkozhakzz.github.io/vinetka-photo-sorter)
│   ├── index.html              # Главная страница портала
│   ├── download.html           # Страница загрузки
│   ├── icon.png                # Иконка приложения
│   └── qr_telegram.svg         # QR-код бота покупки лицензий
├── models/                     # Нейросетевые модели ONNX (YuNet, GenderAge)
└── scripts/
    ├── face_quality_engine.py  # Python-движок классификации и кластеризации лиц
    └── build_mac_release.py    # Сборщик релиза для macOS Apple Silicon arm64
```

---

## 🛠 Разработка и тестирование

### Требования
- Node.js 18+
- Python 3.10+ (`opencv-python`, `numpy`, `onnxruntime`)

### Запуск тестов
```bash
npm test
```
*Результат: 42 из 42 проверок успешно пройдено (100%).*

---

## 📦 Сборка релизных пакетов

### 1. Компиляция `app.asar`
```bash
node build-asar.cjs
```

### 2. Сборка установщика Windows (.exe)
```powershell
& "C:\Users\Ереке\AppData\Local\Programs\Inno Setup 6\ISCC.exe" installer.iss
```
*Файл: `dist/VINETKA-Photo-Sorter-Setup-2.3.0.exe` (150.5 МБ)*

### 3. Сборка для macOS Apple Silicon (.zip)
```bash
python scripts/build_mac_release.py
```
*Файл: `dist/VINETKA-Photo-Sorter-macOS-arm64.zip` (111.0 МБ)*

---

## 📄 Лицензия
© 2026 VINETKA.KZ. Все права защищены.
Разработано для профессиональных школьных фотографов Республики Казахстан.
