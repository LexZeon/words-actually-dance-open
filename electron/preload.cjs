'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const versionArgument = process.argv.find((argument) => argument.startsWith('--wad-version='));

// Expose one small, typed surface. Renderer code has no Node.js or generic IPC access.
contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    platform: process.platform,
    testMode: process.argv.includes('--wad-test-mode'),
    version: versionArgument ? versionArgument.slice('--wad-version='.length) : '0.10.4',
    captureAvailable: process.platform === 'win32',
    chooseAudio: () => ipcRenderer.invoke('wad:choose-audio'),
    chooseScript: () => ipcRenderer.invoke('wad:choose-script'),
    copyText: (text) => ipcRenderer.invoke('wad:copy-text', text),
    exportScript: (payload) =>
      ipcRenderer.invoke('wad:export-script', { title: payload?.title, text: payload?.text }),
    exportText: (payload) =>
      ipcRenderer.invoke('wad:export-text', {
        title: payload?.title,
        text: payload?.text,
      }),
    loadState: () => ipcRenderer.invoke('wad:load-state'),
    saveState: (state) => ipcRenderer.invoke('wad:save-state', state),
    minimize: () => ipcRenderer.invoke('wad:window-control', 'minimize'),
    maximize: () => ipcRenderer.invoke('wad:window-control', 'maximize'),
    close: () => ipcRenderer.invoke('wad:window-control', 'close'),
  }),
);
