'use strict';

// 画面(renderer)に公開する操作だけを限定して渡す
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snr', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  join: (key) => ipcRenderer.invoke('join', key),
  setPaused: (v) => ipcRenderer.invoke('set-paused', v),
  setRegion: (key, v) => ipcRenderer.invoke('set-region', key, v),
  setNotify: (v) => ipcRenderer.invoke('set-notify', v),
  setLogin: (v) => ipcRenderer.invoke('set-login', v),
  setShowAll: (v) => ipcRenderer.invoke('set-show-all', v),
  setFilter: (v) => ipcRenderer.invoke('set-filter', v),
  setHosts: (v) => ipcRenderer.invoke('set-hosts', v),
  setNotifyVacancy: (v) => ipcRenderer.invoke('set-notify-vacancy', v),
  chooseGamePath: () => ipcRenderer.invoke('choose-game-path'),
  launchGame: () => ipcRenderer.invoke('launch-game'),
  setAutoLaunch: (v) => ipcRenderer.invoke('set-auto-launch', v),
  refresh: () => ipcRenderer.invoke('refresh'),
  testNotify: () => ipcRenderer.invoke('test-notify'),
  openSite: () => ipcRenderer.invoke('open-site'),
  openNotifySettings: () => ipcRenderer.invoke('open-notify-settings'),
});
