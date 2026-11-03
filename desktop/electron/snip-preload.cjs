const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("snip", {
  onImage: (callback) => {
    ipcRenderer.on("image", (_event, dataUrl) => callback(dataUrl));
  },
  done: (dataUrl) => ipcRenderer.send("snip-done", dataUrl),
  cancel: () => ipcRenderer.send("snip-cancel"),
});
