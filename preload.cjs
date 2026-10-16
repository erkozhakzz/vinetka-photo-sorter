const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('vinetkaDesktop', {
  selectListFile: () => ipcRenderer.invoke('list:select-file'),
  parseDroppedFile: (filePath) => ipcRenderer.invoke('list:parse-dropped', filePath),
  selectPhotoFolder: (defaultPath) => ipcRenderer.invoke('photos:select-folder', defaultPath),
  loadPhotoFolder: (folderPath) => ipcRenderer.invoke('photos:load-folder', folderPath),
  analyzeCollages: (payload) => ipcRenderer.invoke('ai:analyze-collages', payload),
  saveSorted: (options) => ipcRenderer.invoke('photos:save-sorted', options),
  getLicenseStatus: () => ipcRenderer.invoke('license:get-status'),
  verifyLicense: (code) => ipcRenderer.invoke('license:verify', code),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file.path || '';
    }
  },
  onAiProgress: (callback) => {
    ipcRenderer.on('ai:progress', (_event, data) => callback(data));
  },
  onLicenseUpdate: (callback) => {
    ipcRenderer.on('license:updated', (_event, data) => callback(data));
  }
});
