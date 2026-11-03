const { app, BrowserWindow, Menu, Tray, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, net, protocol, screen } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "mahyar",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  boot();
}

let mainWindow = null;
let tray = null;
let busy = false;

function boot() {
  app.whenReady().then(async () => {
    registerAssets();
    createWindow();
    createTray();
    applyShortcuts("ctrl");
    app.on("second-instance", () => showMain());
    app.on("activate", () => showMain());
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    globalShortcut.unregisterAll();
    if (tray) tray.destroy();
  });

  ipcMain.handle("capture-full", () => captureFull());
  ipcMain.handle("capture-region", () => captureRegion());
  ipcMain.handle("save-png", (_event, dataUrl) => savePng(dataUrl));
  ipcMain.handle("copy-image", (_event, dataUrl) => copyImage(dataUrl));
  ipcMain.handle("set-shortcuts", (_event, preset) => ({ failed: applyShortcuts(preset) }));
}

function assetRoot() {
  if (app.isPackaged) return process.resourcesPath;
  return path.join(__dirname, "../../public");
}

function iconFile() {
  return path.join(__dirname, "../build/icon.png");
}

function registerAssets() {
  protocol.handle("mahyar", async (request) => {
    try {
      const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
      if (!(rel.startsWith("ocr/") || rel.startsWith("tessdata/")) || rel.includes("..")) {
        return new Response("forbidden", { status: 403 });
      }
      const file = path.join(assetRoot(), rel);
      const data = await fs.readFile(file);
      const type = file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream";
      return new Response(data, {
        headers: {
          "Content-Type": type,
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      return new Response("missing", { status: 404 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    title: "Mahyar Image Tools",
    backgroundColor: "#071016",
    autoHideMenuBar: true,
    icon: iconFile(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
    ]),
  );
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  try {
    tray = new Tray(iconFile());
    tray.setToolTip("Mahyar Image Tools");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "انتخاب ناحیه", click: () => void runGlobal("region") },
        { label: "تمام‌صفحه", click: () => void runGlobal("full") },
        { type: "separator" },
        { label: "باز کردن", click: () => showMain() },
        { label: "خروج", click: () => app.quit() },
      ]),
    );
    tray.on("click", () => showMain());
  } catch (error) {
    console.error(error);
  }
}

function showMain() {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideMain() {
  if (mainWindow && mainWindow.isVisible()) mainWindow.hide();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exclusive(task) {
  if (busy) return { ok: false, error: "یک عکس هنوز باز است." };
  busy = true;
  try {
    return await task();
  } finally {
    busy = false;
  }
}

async function grabScreenDataUrl() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const scale = display.scaleFactor || 1;
  const sizes = [1, 0.5];
  for (const factor of sizes) {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.max(1, Math.round(display.size.width * scale * factor)),
        height: Math.max(1, Math.round(display.size.height * scale * factor)),
      },
    });
    const source = sources.find((item) => item.display_id === String(display.id)) || sources[0];
    if (source && !source.thumbnail.isEmpty()) return source.thumbnail.toDataURL();
  }
  throw new Error("عکس صفحه گرفته نشد.");
}

function captureFull() {
  return exclusive(async () => {
    hideMain();
    await delay(220);
    try {
      const dataUrl = await grabScreenDataUrl();
      return { ok: true, dataUrl };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "عکس گرفته نشد." };
    } finally {
      showMain();
    }
  });
}

function captureRegion() {
  return exclusive(async () => {
    hideMain();
    await delay(220);
    try {
      const dataUrl = await grabScreenDataUrl();
      const cropped = await openSnip(dataUrl);
      if (!cropped) return { ok: false, cancelled: true };
      return { ok: true, dataUrl: cropped };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "انتخاب ناحیه ناموفق بود." };
    } finally {
      showMain();
    }
  });
}

function openSnip(dataUrl) {
  return new Promise((resolve) => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    let settled = false;
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      backgroundColor: "#071016",
      webPreferences: {
        preload: path.join(__dirname, "snip-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("snip-done", onDone);
      ipcMain.removeListener("snip-cancel", onCancel);
      resolve(value);
      if (!win.isDestroyed()) win.close();
    };
    const onDone = (_event, cropped) => finish(typeof cropped === "string" ? cropped : null);
    const onCancel = () => finish(null);
    ipcMain.on("snip-done", onDone);
    ipcMain.on("snip-cancel", onCancel);
    win.on("closed", () => finish(null));
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(__dirname, "snip.html"));
    win.webContents.once("did-finish-load", () => {
      if (!win.isDestroyed()) {
        win.webContents.send("image", dataUrl);
        win.focus();
      }
    });
  });
}

async function runGlobal(mode) {
  const result = mode === "full" ? await captureFull() : await captureRegion();
  if (!result.ok || !mainWindow) return;
  showMain();
  mainWindow.webContents.send("global-capture", { mode, dataUrl: result.dataUrl });
}

function applyShortcuts(preset) {
  globalShortcut.unregisterAll();
  const map = {
    ctrl: ["CommandOrControl+Shift+S", "CommandOrControl+Shift+F"],
    alt: ["Alt+Shift+S", "Alt+Shift+F"],
    print: ["PrintScreen", "CommandOrControl+PrintScreen"],
  };
  const pair = map[preset] || map.ctrl;
  const failed = [];
  if (!globalShortcut.register(pair[0], () => void runGlobal("region"))) failed.push(pair[0]);
  if (!globalShortcut.register(pair[1], () => void runGlobal("full"))) failed.push(pair[1]);
  return failed;
}

async function savePng(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const chosen = await dialog.showSaveDialog(mainWindow ?? undefined, {
    defaultPath: path.join(app.getPath("pictures"), `Mahyar-${stamp}.png`),
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (chosen.canceled || !chosen.filePath) return false;
  const image = nativeImage.createFromDataURL(dataUrl);
  await fs.writeFile(chosen.filePath, image.toPNG());
  return true;
}

function copyImage(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return false;
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) return false;
  clipboard.writeImage(image);
  return true;
}
