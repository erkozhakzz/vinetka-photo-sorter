const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vinetkaDesktop', {
  selectListFile: () => ipcRenderer.invoke('list:select-file'),
  selectPhotoFolder: () => ipcRenderer.invoke('photos:select-folder'),
  saveSorted: (files) => ipcRenderer.invoke('photos:save-sorted', files),
});
