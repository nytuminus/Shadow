// Ponte segura entre a interface (que roda em http://localhost) e o Electron.
// Só expõe o que a tela precisa: iniciar com o Windows, esconder e sair.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shadowDesktop', {
  isApp: true,
  platform: process.platform,
  // Avisos do motor ('motor-caiu' / 'motor-voltou') para a tela poder explicar
  // o que está acontecendo em vez de só falhar.
  onMotor: (callback) =>
    ipcRenderer.on('shadow:motor', (_e, evento) => callback(evento)),
  getAutoStart: () => ipcRenderer.invoke('shadow:autostart-get'),
  setAutoStart: (ligado) => ipcRenderer.invoke('shadow:autostart-set', !!ligado),
  hideToTray: () => ipcRenderer.invoke('shadow:hide'),
  quit: () => ipcRenderer.invoke('shadow:quit'),
});
