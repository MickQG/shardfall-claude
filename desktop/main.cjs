'use strict';

// Desktop shell for Shardfall: opens the same static build the website serves. The game code never imports anything from here.
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_ORIGIN, isInternalUrl, resolveAppPath } = require('./paths.cjs');

const ROOT = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b1015',
    title: 'Shardfall',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win && win.show());

  // Links to other sites open in the user's browser, never inside the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  // F11 toggles full screen.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && win) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.on('closed', () => {
    win = null;
  });

  // SHARDFALL_QUERY lets tests and shortcuts start a scenario, e.g. "?faction=alien&difficulty=hard".
  void win.loadURL(`${APP_ORIGIN}/index.html${process.env.SHARDFALL_QUERY || ''}`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('app', (request) => {
      const file = resolveAppPath(ROOT, new URL(request.url).pathname);
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
    });
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => app.quit());
}
