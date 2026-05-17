'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow = null;
let isAlwaysOnTop = false;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 400;
  const winHeight = 800;

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: width - winWidth,
    y: height - winHeight,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '..', 'public', 'logodjbig.png'),
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
}

ipcMain.handle('toggle-always-on-top', () => {
  isAlwaysOnTop = !isAlwaysOnTop;
  mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'floating');
  return isAlwaysOnTop;
});

ipcMain.handle('close-window', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
