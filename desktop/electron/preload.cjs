const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mahyarDesktop", {
  isDesktop: true,
  runtime: {
    workerPath: "mahyar://asset/ocr/worker.min.js",
    corePath: "mahyar://asset/ocr",
    langPath: "mahyar://asset/tessdata",
  },
  captureFull: () => ipcRenderer.invoke("capture-full"),
  captureRegion: () => ipcRenderer.invoke("capture-region"),
  savePng: (dataUrl) => ipcRenderer.invoke("save-png", dataUrl),
  copyImage: (dataUrl) => ipcRenderer.invoke("copy-image", dataUrl),
  setShortcuts: (preset) => ipcRenderer.invoke("set-shortcuts", preset),
  onGlobalCapture: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("global-capture", listener);
    return () => ipcRenderer.removeListener("global-capture", listener);
  },
});
