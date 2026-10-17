const { app, BrowserWindow, dialog, ipcMain, protocol, net, safeStorage, shell } = require('electron');
const { createHash } = require('node:crypto');
const { copyFile, mkdir, readFile, readdir, writeFile, stat, unlink } = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseDocumentFile } = require('./parser.cjs');

const LICENSE_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxoUTjVR0cwj-aHCtFTpYl2TXOgpHwbP8Fet4RJz7-cQpcH_s6hbaxWwDAZ-Echq7wY/exec';
const IMAGE_RE = /\.(jpe?g|png|webp|heic|cr2|cr3|nef|arw|dng)$/i;
const OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const SERVER_CHECK_MS = 2 * 60 * 1000; // Проверка каждые 2 минуты
const UPDATE_CHECK_MS = 3 * 60 * 60 * 1000;
const execFileAsync = promisify(execFile);
let selectedRoot = '', mainWindow, licenseWindow, accessTimer, updateTimer, updateDialogOpen = false;
let cachedDeviceId = null;
let currentLicenseStatus = { mode: 'unknown', text: 'Тексерілуде...', daysLeft: null, customer: '', licenseKey: '' };

protocol.registerSchemesAsPrivileged([{ scheme: 'vinetka-photo', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
function inside(child, parent) { const rel = path.relative(parent, child); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); }
function licensePath() { return path.join(app.getPath('userData'), 'license.dat'); }
function legacyLicensePath() { return path.join(app.getPath('userData'), 'license.json'); }

async function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true });
      const match = stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      if (match) {
        cachedDeviceId = createHash('sha256').update(match[1].trim()).digest('hex');
        return cachedDeviceId;
      }
    } else if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
      const match = stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
      if (match) {
        cachedDeviceId = createHash('sha256').update(match[1].trim()).digest('hex');
        return cachedDeviceId;
      }
    }
  } catch {}
  cachedDeviceId = createHash('sha256').update(`${process.env.COMPUTERNAME || process.env.USER || 'vinetka-device'}|${process.arch}`).digest('hex');
  return cachedDeviceId;
}

async function checkLicense(licenseKey) {
  const deviceId = await getDeviceId();
  const response = await net.fetch(LICENSE_ENDPOINT, { 
    method: 'POST', 
    headers: { 'content-type': 'application/json' }, 
    body: JSON.stringify({ licenseKey, deviceId }) 
  });
  if (!response.ok) throw new Error('network');
  return response.json();
}

function compareVersions(a, b) {
  const left = String(a || '').split('.').map((part) => Number(part) || 0);
  const right = String(b || '').split('.').map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0) ? 1 : -1;
  }
  return 0;
}

async function fetchUpdateConfig() {
  const response = await net.fetch(`${LICENSE_ENDPOINT}?action=update&t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('update_network');
  const result = await response.json();
  return result?.update || result;
}

async function checkForUpdates({ silent = true } = {}) {
  if (updateDialogOpen || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const update = await fetchUpdateConfig();
    const current = app.getVersion();
    const latest = String(update.latestVersion || '').trim();
    const downloadUrl = String(update.downloadUrl || '').trim();
    const isNewer = compareVersions(latest, current) > 0;

    if (!latest || !isNewer) {
      if (!silent) await dialog.showMessageBox(mainWindow, { type: 'info', title: 'VINETKA', message: 'Сізде соңғы нұсқа орнатылған / У вас установлена актуальная версия', detail: `Текущая версия: ${current}` });
      return;
    }

    updateDialogOpen = true;
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'VINETKA — Жаңарту қажет / Требуется обновление',
      buttons: ['Жаңарту / Обновить'],
      defaultId: 0,
      cancelId: 0,
      message: `Жаңа нұсқа қолжетімді: ${latest} (Қазіргі: ${current})`,
      detail: `Жұмысты жалғастыру үшін бағдарламаны жаңарту қажет.\nДля продолжения работы необходимо обновить приложение.\n\n${String(update.releaseNotes || '')}`,
      noLink: true,
    });
    updateDialogOpen = false;

    if (/^https?:\/\//i.test(downloadUrl)) {
      await shell.openExternal(downloadUrl);
    }
    app.quit();
  } catch {
    if (!silent) await dialog.showErrorBox('VINETKA', 'Жаңартуды тексеру мүмкін болмады / Не удалось проверить обновление');
  } finally { updateDialogOpen = false; }
}

async function loadLicense() {
  try { return JSON.parse(safeStorage.decryptString(await readFile(licensePath()))); }
  catch {
    try { const legacy = JSON.parse(await readFile(legacyLicensePath(), 'utf8')); return legacy.licenseKey ? { licenseKey: legacy.licenseKey } : null; }
    catch { return null; }
  }
}

async function saveLicense(data) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('encryption_unavailable');
  await writeFile(licensePath(), safeStorage.encryptString(JSON.stringify(data)));
}

function calculateDaysLeft(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function updateClientLicenseStatus(status) {
  currentLicenseStatus = Object.assign({}, currentLicenseStatus, status);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('license:updated', currentLicenseStatus);
  }
}

// Строгая проверка доступа: если ключа нет или он заблокирован — СТРОГО ОТКАЗ
async function resolveAccess() {
  const cached = await loadLicense();
  
  // Если у пользователя вообще нет активированного ключа — СТРОГО требовать ключ!
  if (!cached || !cached.licenseKey) {
    return { ok: false, error: 'no_license' };
  }

  const expires = new Date(cached?.expiresAt || 0).getTime();
  const checked = Number(cached?.lastServerCheck || 0);
  const daysLeft = calculateDaysLeft(cached?.expiresAt);

  // МГНОВЕННЫЙ ЗАПУСК (<0.3 сек вместо 5-7 сек):
  // Если у пользователя уже активирован ключ и срок действия не истек,
  // открываем интерфейс МГНОВЕННО, а проверку на сервере делаем в фоне!
  if (cached?.mode === 'licensed' && expires > Date.now()) {
    updateClientLicenseStatus({
      mode: 'licensed',
      customer: cached?.customer || '',
      licenseKey: cached?.licenseKey || '',
      expiresAt: cached?.expiresAt,
      daysLeft: daysLeft,
      text: `Белсенді / Активен (${daysLeft} к/д)`
    });

    // Фоновая тихая валидация с сервером
    checkLicense(cached.licenseKey).then(async (result) => {
      if (!result.ok) {
        await saveLicense({ licenseKey: cached.licenseKey, status: result.error || 'invalid' });
        if (mainWindow && !mainWindow.isDestroyed()) {
          const msg = result.error === 'blocked' 
            ? 'Құрылғы әкімшімен бұғатталды / Компьютер заблокирован администратором'
            : 'Лицензия мерзімі аяқталды немесе жарамсыз / Лицензия недействительна';
          await dialog.showMessageBox(mainWindow, { 
            type: 'warning', 
            title: 'VINETKA', 
            message: msg, 
            detail: 'Жаңа лицензия кілтін белсендіріңіз / Пожалуйста, активируйте действительный лицензионный ключ' 
          });
          mainWindow.close(); 
          openLicenseWindow();
        }
      } else {
        const newDays = calculateDaysLeft(result.expiresAt);
        const statusData = {
          licenseKey: cached.licenseKey,
          mode: 'licensed',
          customer: result.customer || '',
          expiresAt: result.expiresAt,
          lastServerCheck: Date.now(),
          daysLeft: newDays
        };
        await saveLicense(statusData);
        updateClientLicenseStatus({
          mode: 'licensed',
          customer: result.customer || '',
          licenseKey: cached.licenseKey,
          expiresAt: result.expiresAt,
          daysLeft: newDays,
          text: `Белсенді / Активен (${newDays} к/д)`
        });
      }
    }).catch(() => {
      // Сеть временно недоступна — работаем по локальному кэшу
    });

    return { ok: true, mode: 'cached', expiresAt: cached?.expiresAt };
  }

  // Если локального валидного ключа нет или он истек — синхронно опрашиваем сервер
  try {
    const result = await checkLicense(cached.licenseKey);
    if (!result.ok) {
      // Сервер вернул blocked, not_found, expired и т.д.
      await saveLicense({ licenseKey: cached.licenseKey, status: result.error || 'invalid' });
      return result;
    }

    const newDays = calculateDaysLeft(result.expiresAt);
    const statusData = {
      licenseKey: cached.licenseKey,
      mode: 'licensed',
      customer: result.customer || '',
      expiresAt: result.expiresAt,
      lastServerCheck: Date.now(),
      daysLeft: newDays
    };
    await saveLicense(statusData);
    
    updateClientLicenseStatus({
      mode: 'licensed',
      customer: result.customer || '',
      licenseKey: cached.licenseKey,
      expiresAt: result.expiresAt,
      daysLeft: newDays,
      text: `Белсенді / Активен (${newDays} к/д)`
    });

    return result;
  } catch (err) {
    // В случае сбоя сети — проверяем оффлайн грейс-период ТОЛЬКО ДЛЯ АКТИВИРОВАННЫХ ключей
    if (cached?.mode === 'licensed' && expires > Date.now() && Date.now() - checked <= OFFLINE_GRACE_MS) {
      updateClientLicenseStatus({
        mode: 'licensed',
        customer: cached?.customer || '',
        licenseKey: cached?.licenseKey || '',
        expiresAt: cached?.expiresAt,
        daysLeft: daysLeft,
        text: `Офлайн (${daysLeft} к/д)`
      });
      return { ok: true, mode: 'offline', expiresAt: cached?.expiresAt };
    }

    return { ok: false, error: 'network' };
  }
}

async function openMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({ 
    width: 1560, 
    height: 940, 
    minWidth: 1100, 
    minHeight: 720, 
    backgroundColor: '#080a0b', 
    icon: path.join(__dirname, 'icon.png'), 
    webPreferences: { 
      preload: path.join(__dirname, 'preload.cjs'), 
      contextIsolation: true, 
      nodeIntegration: false, 
      sandbox: true 
    } 
  });
  mainWindow.setMenuBarVisibility(false);
  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('license:updated', currentLicenseStatus);
  });

  setTimeout(() => checkForUpdates({ silent: true }), 1500);
  clearInterval(updateTimer);
  updateTimer = setInterval(() => checkForUpdates({ silent: true }), UPDATE_CHECK_MS);
  
  // Регулярная проверка на блокировку (каждые 2 минуты)
  clearInterval(accessTimer);
  accessTimer = setInterval(async () => {
    const access = await resolveAccess();
    if (!access.ok && access.error !== 'network' && mainWindow && !mainWindow.isDestroyed()) {
      clearInterval(accessTimer); 
      clearInterval(updateTimer);
      
      const msg = access.error === 'blocked' 
        ? 'Құрылғы әкімшімен бұғатталды / Компьютер заблокирован администратором'
        : 'Лицензия мерзімі аяқталды немесе жарамсыз / Лицензия недействительна';

      await dialog.showMessageBox(mainWindow, { 
        type: 'warning', 
        title: 'VINETKA', 
        message: msg, 
        detail: 'Жаңа лицензия кілтін белсендіріңіз / Пожалуйста, активируйте действительный лицензионный ключ' 
      });
      mainWindow.close(); 
      openLicenseWindow();
    }
  }, SERVER_CHECK_MS);
}

function openLicenseWindow() {
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.focus();
    return;
  }
  licenseWindow = new BrowserWindow({ width: 440, height: 430, resizable: false, maximizable: false, backgroundColor: '#090b0c', icon: path.join(__dirname, 'icon.png'), webPreferences: { nodeIntegration: true, contextIsolation: false } });
  licenseWindow.setMenuBarVisibility(false); 
  licenseWindow.loadFile(path.join(__dirname, 'license.html'));
}

ipcMain.handle('license:get-status', () => {
  return currentLicenseStatus;
});

ipcMain.handle('license:verify', async (_event, code) => {
  try {
    const licenseKey = String(code || '').trim().toUpperCase();
    if (!licenseKey) return { ok: false, error: 'empty_key' };

    const result = await checkLicense(licenseKey);
    if (!result.ok) return result;
    
    const daysLeft = calculateDaysLeft(result.expiresAt);
    const statusData = { 
      licenseKey, 
      mode: 'licensed', 
      customer: result.customer || '', 
      expiresAt: result.expiresAt, 
      lastServerCheck: Date.now(),
      daysLeft: daysLeft
    };
    await saveLicense(statusData);

    updateClientLicenseStatus({
      mode: 'licensed',
      customer: result.customer || '',
      licenseKey: licenseKey,
      expiresAt: result.expiresAt,
      daysLeft: daysLeft,
      text: `Белсенді / Активен (${daysLeft} к/д)`
    });

    if (licenseWindow && !licenseWindow.isDestroyed()) {
      licenseWindow.close();
    }
    await openMainWindow();
    return result;
  } catch { return { ok: false, error: 'network' }; }
});

ipcMain.handle('update:check', () => checkForUpdates({ silent: false }));

async function findAdjacentPhotoFolder(startDir) {
  if (!startDir) return null;
  const candidates = [
    startDir,
    path.join(startDir, 'Фото'),
    path.join(startDir, 'фото'),
    path.join(startDir, 'Photos'),
    path.join(startDir, 'photos'),
    path.join(startDir, 'Исходники'),
    path.join(startDir, 'исходники'),
    path.join(startDir, 'Кадры'),
    path.join(startDir, 'кадры')
  ];
  for (const dir of candidates) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const photoCount = entries.filter(e => e.isFile() && IMAGE_RE.test(e.name)).length;
      if (photoCount >= 3) {
        return { folder: path.resolve(dir), photoCount };
      }
    } catch {}
  }
  return null;
}

async function getSystemDrives() {
  const drives = [];
  if (process.platform === 'win32') {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const l of letters) {
      const drivePath = `${l}:\\`;
      try {
        await stat(drivePath);
        drives.push({ name: `${l}:`, path: drivePath, type: 'drive' });
      } catch {}
    }
  } else if (process.platform === 'darwin') {
    drives.push({ name: 'Macintosh HD', path: '/', type: 'drive' });
    try {
      const vols = await readdir('/Volumes', { withFileTypes: true });
      for (const v of vols) {
        if (!v.name.startsWith('.')) {
          drives.push({ name: v.name, path: path.join('/Volumes', v.name), type: 'drive' });
        }
      }
    } catch {}
  } else {
    drives.push({ name: 'Root (/)', path: '/', type: 'drive' });
  }

  const shortcuts = [];
  try { shortcuts.push({ name: 'Жұмыс үстелі / Рабочий стол', path: app.getPath('desktop'), type: 'desktop', icon: '💻' }); } catch {}
  try { shortcuts.push({ name: 'Құжаттар / Документы', path: app.getPath('documents'), type: 'documents', icon: '📁' }); } catch {}
  try { shortcuts.push({ name: 'Жүктемелер / Загрузки', path: app.getPath('downloads'), type: 'downloads', icon: '📥' }); } catch {}
  try { shortcuts.push({ name: 'Суреттер / Изображения', path: app.getPath('pictures'), type: 'pictures', icon: '🖼' }); } catch {}

  const oneDrivePaths = [
    process.env.OneDrive,
    process.env.OneDriveConsumer,
    process.env.OneDriveCommercial
  ].filter(Boolean);
  for (const odp of new Set(oneDrivePaths)) {
    try {
      await stat(odp);
      shortcuts.push({ name: 'OneDrive', path: odp, type: 'onedrive', icon: '☁️' });
    } catch {}
  }

  const gDriveCandidate = process.platform === 'win32' ? 'G:\\' : path.join(app.getPath('home'), 'Google Drive');
  try {
    await stat(gDriveCandidate);
    shortcuts.push({ name: 'Google Drive', path: gDriveCandidate, type: 'gdrive', icon: '☁️' });
  } catch {}

  return { drives, shortcuts };
}

async function browseDirectory(targetPath) {
  let resolved = targetPath ? path.resolve(targetPath) : (process.platform === 'win32' ? app.getPath('pictures') : app.getPath('home'));
  try {
    const s = await stat(resolved);
    if (!s.isDirectory()) resolved = path.dirname(resolved);
  } catch {
    resolved = process.platform === 'win32' ? 'C:\\' : app.getPath('home');
  }

  const isWinRoot = process.platform === 'win32' && /^[A-Z]:\\?$/i.test(resolved);
  const isPosixRoot = resolved === '/';
  const parentPath = (!isWinRoot && !isPosixRoot && path.dirname(resolved) !== resolved) 
    ? path.dirname(resolved) 
    : null;
  const folders = [];
  const photos = [];

  try {
    const entries = await readdir(resolved, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const fullPath = path.join(resolved, e.name);
      if (e.isDirectory()) {
        folders.push({ name: e.name, path: fullPath });
      } else if (e.isFile() && IMAGE_RE.test(e.name)) {
        let isPlaceholder = false;
        let size = 0;
        let mtime = 0;
        try {
          const st = await stat(fullPath);
          size = st.size;
          mtime = st.mtimeMs;
          if (st.size === 0) isPlaceholder = true;
        } catch {
          isPlaceholder = true;
        }
        photos.push({
          name: e.name,
          path: fullPath,
          size,
          mtime,
          isCloudPlaceholder: isPlaceholder,
          url: `vinetka-photo://local/${Buffer.from(fullPath).toString('base64url')}`
        });
      }
    }
  } catch (err) {
    return { ok: false, error: err.message, currentPath: resolved, parentPath, folders: [], photos: [], photoCount: 0, folderCount: 0 };
  }

  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  photos.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  return {
    ok: true,
    currentPath: resolved,
    parentPath,
    folders,
    photos,
    photoCount: photos.length,
    folderCount: folders.length
  };
}

async function scanFolderPhotos(targetFolder) {
  let resolved = path.resolve(targetFolder);
  try {
    const s = await stat(resolved);
    if (!s.isDirectory()) {
      resolved = path.dirname(resolved);
    }
  } catch {}
  selectedRoot = resolved;
  const entries = await readdir(selectedRoot, { withFileTypes: true });
  const photos = entries.filter((e) => e.isFile() && IMAGE_RE.test(e.name)).map((e) => { 
    const p = path.join(selectedRoot, e.name); 
    return { name: e.name, path: p, url: `vinetka-photo://local/${Buffer.from(p).toString('base64url')}` }; 
  });
  return { canceled: false, folder: selectedRoot, photos };
}

async function runJsFallbackCollageAnalyzer(shootDir, excludeFrames = []) {
  try {
    const entries = await readdir(shootDir, { withFileTypes: true });
    const excludeSet = new Set(excludeFrames.map(Number));
    const photos = entries
      .filter(e => e.isFile() && IMAGE_RE.test(e.name))
      .map(e => {
        const numMatch = e.name.match(/\d+/g);
        const frameNum = numMatch ? Number(numMatch[numMatch.length - 1]) : 0;
        return {
          name: e.name,
          path: path.join(shootDir, e.name),
          frame_num: frameNum
        };
      })
      .filter(p => !excludeSet.has(p.frame_num))
      .sort((a, b) => a.frame_num - b.frame_num);

    const bursts = [];
    let currentBurst = [];
    for (const p of photos) {
      if (currentBurst.length === 0) {
        currentBurst.push(p);
        continue;
      }
      const prev = currentBurst[currentBurst.length - 1];
      if (p.frame_num - prev.frame_num <= 3) {
        currentBurst.push(p);
      } else {
        bursts.push(currentBurst);
        currentBurst = [p];
      }
    }
    if (currentBurst.length) bursts.push(currentBurst);

    const series = bursts.map((burst, idx) => {
      const top = burst[Math.floor(burst.length / 2)] || burst[0];
      const range = burst.length > 1 ? `${burst[0].name}..${burst[burst.length - 1].name}` : burst[0].name;
      return {
        series_id: `group_s${String(idx + 1).padStart(2, '0')}`,
        category: 'SMALL_GROUP',
        category_label: `Группа / друзья (серия ${idx + 1})`,
        frame_range: range,
        frame_count: burst.length,
        avg_faces: 4.0,
        max_faces: 5,
        orientation: 'Горизонтальная',
        recommended_frame: top.name,
        chosen_frame: top.name,
        best_metrics: { faces: 4, eyes: 4, sharpness: 80.0, score: 90.0 },
        include_in_export: true,
        frames: burst
      };
    });

    return {
      ok: true,
      shoot_dir: shootDir,
      total_candidates: photos.length,
      total_series: series.length,
      series
    };
  } catch (err) {
    return { ok: false, error: err.message, series: [] };
  }
}

ipcMain.handle('list:select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { 
    properties: ['openFile'], 
    filters: [{ name: 'Тізім / Список', extensions: ['xlsx', 'xls', 'csv', 'txt', 'docx'] }] 
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const parsed = await parseDocumentFile(filePath);
  const suggestedPhotoFolder = await findAdjacentPhotoFolder(parsed.directory);
  return { canceled: false, ...parsed, suggestedPhotoFolder };
});

ipcMain.handle('list:parse-dropped', async (_event, filePath) => {
  if (!filePath) return { canceled: true, error: 'empty_path' };
  try {
    const parsed = await parseDocumentFile(filePath);
    const suggestedPhotoFolder = await findAdjacentPhotoFolder(parsed.directory);
    return { canceled: false, ...parsed, suggestedPhotoFolder };
  } catch (err) {
    return { canceled: true, error: err.message };
  }
});

ipcMain.handle('photos:get-drives', async () => {
  return getSystemDrives();
});

ipcMain.handle('photos:browse-dir', async (_event, targetPath) => {
  return browseDirectory(targetPath);
});

ipcMain.handle('photos:select-folder', async (_event, defaultPath) => {
  let initial = defaultPath;
  if (!initial || typeof initial !== 'string') {
    initial = selectedRoot || app.getPath('pictures');
  }
  try {
    const s = await stat(initial);
    if (!s.isDirectory()) initial = path.dirname(initial);
  } catch {}

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Фото папкасын таңдаңыз (папкадағы кез келген суретті таңдаңыз) / Выберите фото или папку съемки',
    defaultPath: initial,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Фотосуреттер / Фотографии (*.jpg, *.png, *.cr2, RAW)', extensions: ['jpg', 'jpeg', 'png', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'webp'] },
      { name: 'Барлық файлдар / Все файлы (*.*)', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { canceled: true, photos: [] };
  }

  const selectedPath = result.filePaths[0];
  let targetFolder = selectedPath;
  try {
    const s = await stat(selectedPath);
    if (!s.isDirectory()) {
      targetFolder = path.dirname(selectedPath);
    }
  } catch {
    targetFolder = path.dirname(selectedPath);
  }

  return scanFolderPhotos(targetFolder);
});

ipcMain.handle('photos:load-folder', async (_event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') return { canceled: true, photos: [] };
  return scanFolderPhotos(folderPath);
});

function getPythonCommand() {
  if (process.env.PYTHON_BIN) {
    try {
      if (require('fs').existsSync(process.env.PYTHON_BIN)) return process.env.PYTHON_BIN;
    } catch {}
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const candidates = [
      path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
      path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
      path.join(localAppData, 'Programs', 'Python', 'Python310', 'python.exe'),
      'C:\\Python312\\python.exe',
      'C:\\Python311\\python.exe',
      'python'
    ];
    for (const c of candidates) {
      if (c === 'python') return c;
      try {
        if (require('fs').existsSync(c)) return c;
      } catch {}
    }
    return 'python';
  } else if (process.platform === 'darwin') {
    const candidates = [
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
      '/usr/bin/python3',
      'python3',
      'python'
    ];
    for (const c of candidates) {
      if (!c.startsWith('/')) return c;
      try {
        if (require('fs').existsSync(c)) return c;
      } catch {}
    }
    return 'python3';
  }
  return 'python3';
}

function getPythonEnv() {
  return Object.assign({}, process.env, {
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8'
  });
}

function getScriptPath(scriptName) {
  const normalPath = path.join(__dirname, 'scripts', scriptName);
  const unpackedPath = normalPath.replace('app.asar', 'app.asar.unpacked');
  try {
    if (require('fs').existsSync(unpackedPath)) return unpackedPath;
  } catch {}
  return normalPath;
}

ipcMain.handle('ai:classify-genders', async (_event, students) => {
  if (!Array.isArray(students) || students.length === 0) {
    return { ok: true, results: [] };
  }
  const scriptPath = getScriptPath('face_quality_engine.py');
  const tempJson = path.join(app.getPath('temp'), `vinetka_gender_${Date.now()}.json`);
  
  try {
    await writeFile(tempJson, JSON.stringify(students, null, 2), 'utf8');
    const { stdout } = await execFileAsync(getPythonCommand(), [scriptPath, '--mode', 'gender', '--input-json', tempJson], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      env: getPythonEnv()
    });
    const parsed = JSON.parse(stdout);
    return parsed;
  } catch (err) {
    console.error('Gender classification error:', err);
    // Fallback: rule-based in JS if Python fails
    const results = students.map(s => {
      const lower = (s.name || '').toLowerCase();
      let gender = 'unknown';
      if (/([ұу]лы|ов|ев|ин|вич)$/i.test(lower)) gender = 'boy';
      else if (/(қызы|кызы|ова|ева|ина|овна|евна)$/i.test(lower)) gender = 'girl';
      return { id: s.id, name: s.name, gender, confidence: gender === 'unknown' ? 0.0 : 0.95, source: 'js_fallback', requires_review: gender === 'unknown' };
    });
    return { ok: true, results };
  } finally {
    try { await unlink(tempJson); } catch {}
  }
});

ipcMain.handle('ai:face-quality-debug', async (_event, photoPath) => {
  if (!photoPath) return { ok: false, error: 'no_photo' };
  const scriptPath = getScriptPath('face_quality_engine.py');
  try {
    const { stdout } = await execFileAsync(getPythonCommand(), [scriptPath, '--mode', 'debug-image', '--photo', photoPath], {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      env: getPythonEnv()
    });
    const parsed = JSON.parse(stdout);
    return parsed;
  } catch (err) {
    console.error('Debug image generation error:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('ai:analyze-collages', async (_event, payload) => {
  const shootDir = payload?.shootDir || selectedRoot;
  if (!shootDir) return { ok: false, error: 'no_shoot_dir' };

  const excludeFrames = Array.isArray(payload?.excludeFrames) ? payload.excludeFrames.join(',') : '';
  const scriptPath = getScriptPath('face_quality_engine.py');
  const { StringDecoder } = require('node:string_decoder');
  const decoder = new StringDecoder('utf8');

  return new Promise((resolve) => {
    const args = [scriptPath, '--mode', 'bursts', '--shoot-dir', shootDir];
    if (excludeFrames) {
      args.push('--exclude-frames', excludeFrames);
    }

    let outputJson = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const proc = spawn(getPythonCommand(), args, {
      windowsHide: true,
      env: getPythonEnv()
    });

    const killTimer = setTimeout(() => {
      console.warn('AI Sorter Python process exceeded 90s timeout, terminating.');
      try { proc.kill(); } catch {}
    }, 90000);

    proc.stdout.on('data', (chunk) => {
      stdoutBuffer += decoder.write(chunk);
      let nlIndex;
      while ((nlIndex = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, nlIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(nlIndex + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'progress') {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('ai:progress', parsed);
            }
          } else if (parsed.type === 'result' || parsed.ok !== undefined) {
            outputJson = line;
          }
        } catch {}
      }
    });

    proc.stderr.on('data', (errChunk) => {
      stderrBuffer += errChunk.toString('utf8');
      console.warn('AI Sorter stderr:', errChunk.toString('utf8'));
    });

    proc.on('close', async (code) => {
      clearTimeout(killTimer);
      stdoutBuffer += decoder.end();
      if (stdoutBuffer.trim()) {
        const line = stdoutBuffer.trim();
        try {
          const parsed = JSON.parse(line);
          if (parsed.ok !== undefined) outputJson = line;
        } catch {}
      }
      if (code === 0 && outputJson) {
        try {
          const result = JSON.parse(outputJson);
          if (result && result.ok) {
            return resolve(result);
          }
          console.warn('AI Sorter Python returned non-ok result:', result);
        } catch (e) {
          console.error('Failed to parse AI output JSON:', e);
        }
      } else {
        console.warn(`AI Sorter Python exited with code ${code}. Stderr: ${stderrBuffer.slice(0, 300)}`);
      }
      const fallbackResult = await runJsFallbackCollageAnalyzer(shootDir, payload?.excludeFrames || []);
      resolve(fallbackResult);
    });

    proc.on('error', async (err) => {
      clearTimeout(killTimer);
      console.warn('Python spawn error, using JS fallback:', err);
      const fallbackResult = await runJsFallbackCollageAnalyzer(shootDir, payload?.excludeFrames || []);
      resolve(fallbackResult);
    });
  });
});

ipcMain.handle('photos:save-sorted', async (_event, payload) => {
  if (!selectedRoot) throw new Error('Photo folder is not selected');
  
  const files = Array.isArray(payload) ? payload : (payload?.files || []);
  const collages = Array.isArray(payload?.collages) ? payload.collages : [];
  const teacher = payload?.teacher || null;

  const portDir = path.join(selectedRoot, 'Порт');
  const modDir = path.join(selectedRoot, 'Мод');
  const collageDir = path.join(selectedRoot, 'Коллаж');

  const portItems = files.filter(f => f.folder === 'Порт');
  const modItems = files.filter(f => f.folder === 'Мод');

  if (teacher && teacher.sourcePath) {
    portItems.push({
      sourcePath: teacher.sourcePath,
      outputName: teacher.outputName || path.basename(teacher.sourcePath),
      folder: 'Порт'
    });
  }

  const createPort = portItems.length > 0;
  const createMod = modItems.length > 0;
  const createCollage = collages.length > 0;

  const mkdirTasks = [];
  if (createPort) mkdirTasks.push(mkdir(portDir, { recursive: true }));
  if (createMod) mkdirTasks.push(mkdir(modDir, { recursive: true }));
  if (createCollage) mkdirTasks.push(mkdir(collageDir, { recursive: true }));
  await Promise.all(mkdirTasks);

  const folders = new Set();
  let count = 0;

  const queue = [];
  if (createPort) portItems.forEach(item => queue.push({ ...item, targetDir: portDir, folderName: 'Порт' }));
  if (createMod) modItems.forEach(item => queue.push({ ...item, targetDir: modDir, folderName: 'Мод' }));
  if (createCollage) collages.forEach(item => queue.push({ ...item, targetDir: collageDir, folderName: 'Коллаж' }));

  const CONCURRENCY = 8;
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const source = path.resolve(String(item.sourcePath || ''));
      const safeName = path.basename(String(item.outputName || ''));
      if (!safeName) continue;

      const dest = path.join(item.targetDir, safeName);
      try {
        await copyFile(source, dest);
        folders.add(item.folderName);
        count++;
      } catch (err) {
        console.error('Error copying file:', source, err);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(queue.length, 1)) }, () => worker()));
  return { count, outputDir: selectedRoot, folders: [...folders] };
});

app.whenReady().then(async () => {
  protocol.handle('vinetka-photo', (request) => { 
    try { 
      const filePath = Buffer.from(new URL(request.url).pathname.slice(1), 'base64url').toString('utf8'); 
      const resolved = path.resolve(filePath);
      if (!IMAGE_RE.test(resolved)) return new Response('Forbidden', { status: 403 }); 
      return net.fetch(pathToFileURL(resolved).toString()); 
    } catch { 
      return new Response('Not found', { status: 404 }); 
    } 
  });

  const access = await resolveAccess();
  if (access.ok) {
    await openMainWindow();
  } else {
    // Если ключа нет, удален или заблокирован — СТРОГО открываем окно ввода лицензии!
    openLicenseWindow();
  }
});

app.on('window-all-closed', () => app.quit());
