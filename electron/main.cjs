'use strict';

const { app, BrowserWindow, ipcMain, screen, net, protocol } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

let mainWindow = null;
let isAlwaysOnTop = false;

// Must be called before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 428; // 400 game + 28 left bar
  const winHeight = 832;

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: width - winWidth,
    y: height - winHeight,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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

  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('fullscreen-changed', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('fullscreen-changed', false));

  if (process.env.ELECTRON_DEV === '1') {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadURL('app://localhost/index.html');
  }
}

ipcMain.handle('toggle-always-on-top', () => {
  isAlwaysOnTop = !isAlwaysOnTop;
  mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'floating');
  return isAlwaysOnTop;
});

ipcMain.handle('set-opacity', (_, value) => {
  const opacity = Math.min(1, Math.max(0.1, value));
  mainWindow.setOpacity(opacity);
  return opacity;
});

ipcMain.handle('close-window', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('resize-window', (_, { width, height }) => {
  if (!mainWindow) return;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setSize(width, height);
  mainWindow.setPosition(sw - width, sh - height);
});

ipcMain.handle('set-fullscreen', (_, value) => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(value);
  return value;
});

app.whenReady().then(() => {
  const distDir = app.isPackaged
    ? path.join(app.getAppPath(), 'dist')
    : path.join(__dirname, '..', 'dist');

  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.join(distDir, decodeURIComponent(pathname));
    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
