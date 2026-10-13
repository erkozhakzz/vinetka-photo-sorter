const { app, BrowserWindow, dialog, ipcMain, protocol, net, safeStorage, shell } = require('electron');
const { createHash } = require('node:crypto');
const { copyFile, mkdir, readFile, readdir, writeFile } = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const XLSX = require('xlsx');
const mammoth = require('mammoth');

const LICENSE_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxoUTjVR0cwj-aHCtFTpYl2TXOgpHwbP8Fet4RJz7-cQpcH_s6hbaxWwDAZ-Echq7wY/exec';
const IMAGE_RE = /\.(jpe?g|png|webp|heic|cr2|cr3|nef|arw|dng)$/i;
const OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const SERVER_CHECK_MS = 3 * 60 * 1000;
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
    const { stdout } = await execFileAsync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true });
    const match = stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    if (match) {
      cachedDeviceId = createHash('sha256').update(match[1].trim()).digest('hex');
      return cachedDeviceId;
    }
  } catch {}
  cachedDeviceId = createHash('sha256').update(`${process.env.COMPUTERNAME || ''}|${process.arch}`).digest('hex');
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
    const minimum = String(update.minimumVersion || '').trim();
    const downloadUrl = String(update.downloadUrl || '').trim();
    const forced = update.forceUpdate === true || String(update.forceUpdate).toUpperCase() === 'TRUE' || (minimum && compareVersions(current, minimum) < 0);
    if (!latest || compareVersions(latest, current) <= 0) {
      if (!silent) await dialog.showMessageBox(mainWindow, { type: 'info', title: 'VINETKA', message: 'Сізде соңғы нұсқа орнатылған', detail: `Текущая версия: ${current}` });
      return;
    }
    updateDialogOpen = true;
    const buttons = forced ? ['Жаңарту / Обновить'] : ['Жаңарту / Обновить', 'Кейін / Позже'];
    const choice = await dialog.showMessageBox(mainWindow, {
      type: forced ? 'warning' : 'info', title: 'VINETKA — Жаңарту', buttons, cancelId: forced ? -1 : 1, defaultId: 0,
      message: `Жаңа нұсқа қолжетімді: ${latest}`,
      detail: `${forced ? 'Бұл міндетті жаңарту.\nЭто обязательное обновление.\n\n' : ''}${String(update.releaseNotes || '')}\n\nОрнатылған / Установлено: ${current}`,
      noLink: true,
    });
    updateDialogOpen = false;
    if (choice.response === 0) {
      if (!/^https:\/\//i.test(downloadUrl)) {
        await dialog.showErrorBox('VINETKA', 'Жүктеу сілтемесі орнатылмаған / Ссылка загрузки не настроена');
        if (forced) app.quit();
        return;
      }
      await shell.openExternal(downloadUrl);
      if (forced) app.quit();
    } else if (forced) app.quit();
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

async function resolveAccess() {
  const cached = await loadLicense();
  try {
    const result = await checkLicense(cached?.licenseKey || '');
    if (!result.ok) {
      if (result.error === 'blocked') {
        updateClientLicenseStatus({ mode: 'blocked', text: 'Бұғатталған / Заблокирован', daysLeft: 0, error: 'blocked' });
      }
      return result;
    }

    const daysLeft = calculateDaysLeft(result.expiresAt);
    const mode = result.mode;
    const statusData = {
      licenseKey: cached?.licenseKey || '',
      mode: mode,
      customer: result.customer || '',
      expiresAt: result.expiresAt,
      lastServerCheck: Date.now(),
      daysLeft: daysLeft
    };
    await saveLicense(statusData);
    
    updateClientLicenseStatus({
      mode: mode,
      customer: result.customer || '',
      licenseKey: cached?.licenseKey || '',
      expiresAt: result.expiresAt,
      daysLeft: daysLeft,
      text: mode === 'trial' ? `Сынақ / Пробный (${daysLeft} к/д)` : `Белсенді / Активен (${daysLeft} к/д)`
    });

    return result;
  } catch (err) {
    const expires = new Date(cached?.expiresAt || 0).getTime();
    const checked = Number(cached?.lastServerCheck || 0);
    const daysLeft = calculateDaysLeft(cached?.expiresAt);

    if (expires > Date.now() && Date.now() - checked <= OFFLINE_GRACE_MS) {
      const mode = cached?.mode || 'offline';
      updateClientLicenseStatus({
        mode: mode,
        customer: cached?.customer || '',
        licenseKey: cached?.licenseKey || '',
        expiresAt: cached?.expiresAt,
        daysLeft: daysLeft,
        text: `Офлайн (${daysLeft} к/д)`
      });
      return { ok: true, mode: 'offline', expiresAt: cached?.expiresAt };
    }

    updateClientLicenseStatus({ mode: 'error', text: 'Интернет жоқ / Нет сети', daysLeft: daysLeft, error: 'network' });
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

  setTimeout(() => checkForUpdates({ silent: true }), 4000);
  clearInterval(updateTimer);
  updateTimer = setInterval(() => checkForUpdates({ silent: true }), UPDATE_CHECK_MS);
  
  clearInterval(accessTimer);
  accessTimer = setInterval(async () => {
    const access = await resolveAccess();
    if (!access.ok && access.error !== 'network' && mainWindow && !mainWindow.isDestroyed()) {
      clearInterval(accessTimer); 
      clearInterval(updateTimer);
      
      const msg = access.error === 'blocked' 
        ? 'Құрылғы әкімшімен бұғатталды / Компьютер заблокирован администратором'
        : 'Қолжетімділік тоқтатылды / Доступ приостановлен';

      await dialog.showMessageBox(mainWindow, { 
        type: 'warning', 
        title: 'VINETKA', 
        message: msg, 
        detail: 'Лицензияны тексеріңіз немесе жаңа кілт енгізіңіз / Обратитесь к администратору или активируйте новый ключ' 
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
  licenseWindow = new BrowserWindow({ width: 430, height: 420, resizable: false, maximizable: false, backgroundColor: '#090b0c', icon: path.join(__dirname, 'icon.png'), webPreferences: { nodeIntegration: true, contextIsolation: false } });
  licenseWindow.setMenuBarVisibility(false); 
  licenseWindow.loadFile(path.join(__dirname, 'license.html'));
}

ipcMain.handle('license:get-status', () => {
  return currentLicenseStatus;
});

ipcMain.handle('license:verify', async (_event, code) => {
  try {
    const licenseKey = String(code || '').trim().toUpperCase();
    const result = await checkLicense(licenseKey);
    if (!result.ok) return result;
    
    const daysLeft = calculateDaysLeft(result.expiresAt);
    const statusData = { 
      licenseKey, 
      mode: result.mode, 
      customer: result.customer || '', 
      expiresAt: result.expiresAt, 
      lastServerCheck: Date.now(),
      daysLeft: daysLeft
    };
    await saveLicense(statusData);

    updateClientLicenseStatus({
      mode: result.mode,
      customer: result.customer || '',
      licenseKey: licenseKey,
      expiresAt: result.expiresAt,
      daysLeft: daysLeft,
      text: result.mode === 'trial' ? `Сынақ / Пробный (${daysLeft} к/д)` : `Белсенді / Активен (${daysLeft} к/д)`
    });

    if (licenseWindow && !licenseWindow.isDestroyed()) {
      licenseWindow.close();
      await openMainWindow();
    }
    return result;
  } catch { return { ok: false, error: 'network' }; }
});

ipcMain.handle('update:check', () => checkForUpdates({ silent: false }));

ipcMain.handle('list:select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Тізім / Список', extensions: ['xlsx', 'xls', 'csv', 'txt', 'docx'] }] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0], ext = path.extname(filePath).toLowerCase(); let text = '';
  if (['.xlsx', '.xls', '.csv'].includes(ext)) { const book = XLSX.readFile(filePath); text = book.SheetNames.map((name) => XLSX.utils.sheet_to_csv(book.Sheets[name], { FS: ' | ' })).join('\n'); }
  else if (ext === '.docx') text = (await mammoth.extractRawText({ path: filePath })).value;
  else text = await readFile(filePath, 'utf8');
  return { canceled: false, name: path.basename(filePath), text };
});

ipcMain.handle('photos:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true, photos: [] };
  selectedRoot = path.resolve(result.filePaths[0]); 
  const entries = await readdir(selectedRoot, { withFileTypes: true });
  const photos = entries.filter((e) => e.isFile() && IMAGE_RE.test(e.name)).map((e) => { 
    const p = path.join(selectedRoot, e.name); 
    return { name: e.name, path: p, url: `vinetka-photo://local/${Buffer.from(p).toString('base64url')}` }; 
  });
  return { canceled: false, folder: selectedRoot, photos };
});

ipcMain.handle('photos:save-sorted', async (_event, files) => {
  if (!selectedRoot) throw new Error('Photo folder is not selected');
  const items = Array.isArray(files) ? files : [];
  if (!items.length) return { count: 0, outputDir: selectedRoot, folders: [] };

  const portDir = path.join(selectedRoot, 'Порт');
  const modDir = path.join(selectedRoot, 'Мод');
  await Promise.all([
    mkdir(portDir, { recursive: true }),
    mkdir(modDir, { recursive: true })
  ]);

  const folders = new Set();
  let count = 0;
  const queue = [...items];
  const CONCURRENCY = 8;

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const source = path.resolve(String(item.sourcePath || ''));
      const safeName = path.basename(String(item.outputName || ''));
      const folder = item.folder === 'Мод' ? 'Мод' : 'Порт';
      if (!inside(source, selectedRoot) || !safeName || safeName !== item.outputName) continue;

      const outputDir = folder === 'Мод' ? modDir : portDir;
      await copyFile(source, path.join(outputDir, safeName));
      folders.add(folder);
      count++;
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
  return { count, outputDir: selectedRoot, folders: [...folders] };
});

app.whenReady().then(async () => {
  protocol.handle('vinetka-photo', (request) => { 
    try { 
      const filePath = Buffer.from(new URL(request.url).pathname.slice(1), 'base64url').toString('utf8'); 
      if (!selectedRoot || !inside(path.resolve(filePath), selectedRoot)) return new Response('Forbidden', { status: 403 }); 
      return net.fetch(pathToFileURL(filePath).toString()); 
    } catch { 
      return new Response('Not found', { status: 404 }); 
    } 
  });

  const cached = await loadLicense();
  const expires = new Date(cached?.expiresAt || 0).getTime();
  const isCacheValid = (cached?.mode === 'licensed' || cached?.mode === 'trial') && (expires > Date.now() || !cached.expiresAt);

  if (isCacheValid) {
    const daysLeft = calculateDaysLeft(cached?.expiresAt);
    currentLicenseStatus = {
      mode: cached.mode,
      customer: cached.customer || '',
      licenseKey: cached.licenseKey || '',
      expiresAt: cached.expiresAt,
      daysLeft: daysLeft,
      text: cached.mode === 'trial' ? `Сынақ / Пробный (${daysLeft} к/д)` : `Белсенді / Активен (${daysLeft} к/д)`
    };

    await openMainWindow();
    
    resolveAccess().then(access => {
      if (!access.ok && access.error !== 'network' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
        openLicenseWindow();
      }
    }).catch(() => {});
  } else {
    const access = await resolveAccess();
    if (access.ok) {
      await openMainWindow();
    } else {
      openLicenseWindow();
    }
  }
});

app.on('window-all-closed', () => app.quit());
