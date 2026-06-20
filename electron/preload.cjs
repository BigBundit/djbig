'use strict';

const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  setOpacity: (value) => ipcRenderer.invoke('set-opacity', value),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', { width, height }),
  setFullscreen: (value) => ipcRenderer.invoke('set-fullscreen', value),
  onFullscreenChange: (callback) => ipcRenderer.on('fullscreen-changed', (_, value) => callback(value)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
});
