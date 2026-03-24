const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, net, protocol, shell, nativeImage } = require('electron');
const { LocalDataStore } = require('./services/dataStore');
const { LinkPreviewService } = require('./services/linkPreviewService');
const { AiService } = require('./services/aiService');
const { parseAssetUrl } = require('./services/blobStore');
const { SecretStore } = require('./services/secretStore');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'paopao-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow = null;
let store = null;
let linkPreviewService = null;
let aiService = null;
let secretStore = null;

function getAppRoot() {
  return app.getAppPath();
}

function getLegacyDataDir() {
  return path.resolve(getAppRoot(), '../data');
}

function getPreloadPath() {
  return path.join(getAppRoot(), 'dist/preload/index.js');
}

function emitRendererEvent(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

async function openWithDefaultApp(target) {
  if (typeof target !== 'string' || !target.trim()) {
    throw new Error('Attachment URL is required');
  }

  const normalized = target.trim();
  const resolvedAttachmentPath = store.resolveAttachmentAbsolutePath(normalized);
  if (resolvedAttachmentPath) {
    const result = await shell.openPath(resolvedAttachmentPath);
    if (result) {
      throw new Error(result);
    }
    return { ok: true };
  }

  if (path.isAbsolute(normalized)) {
    const result = await shell.openPath(normalized);
    if (result) {
      throw new Error(result);
    }
    return { ok: true };
  }

  if (/^file:\/\//i.test(normalized)) {
    const result = await shell.openPath(fileURLToPath(normalized));
    if (result) {
      throw new Error(result);
    }
    return { ok: true };
  }

  if (/^https?:\/\//i.test(normalized)) {
    await shell.openExternal(normalized);
    return { ok: true };
  }

  throw new Error('Unsupported attachment URL');
}

function getRendererEntry() {
  const devUrl = process.env.VITE_DEV_SERVER_URL || process.env.PAOPAO_RENDERER_URL;
  if (devUrl) return { type: 'url', value: devUrl };
  return {
    type: 'file',
    value: path.join(getAppRoot(), 'dist/renderer/index.html'),
  };
}

function getDevAppIconPath() {
  return path.join(getAppRoot(), 'build/icon.png');
}

function applyMacDockIcon() {
  if (process.platform !== 'darwin') return;
  const iconPath = getDevAppIconPath();
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) return;
  app.dock.setIcon(icon);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openWithDefaultApp(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!/^https?:\/\//i.test(url)) return;
    event.preventDefault();
    openWithDefaultApp(url).catch(() => {});
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const entry = getRendererEntry();
  if (entry.type === 'url') {
    mainWindow.loadURL(entry.value);
  } else {
    mainWindow.loadFile(entry.value);
  }
}

function registerAssetProtocol() {
  protocol.handle('paopao-asset', async (request) => {
    const assetId = parseAssetUrl(request.url);
    const absolutePath = store.resolveAssetAbsolutePath(assetId);
    if (!absolutePath) {
      return new Response('Not Found', { status: 404 });
    }
    return net.fetch(pathToFileURL(absolutePath).toString());
  });
}

function registerIpcHandlers() {
  ipcMain.handle('conversation:list', () => store.listConversations());
  ipcMain.handle('conversation:get', (_event, conversationId) => store.getConversation(conversationId));
  ipcMain.handle('conversation:save', (_event, payload) => store.upsertConversation(payload));
  ipcMain.handle('conversation:create', (_event, payload) => store.createConversation(payload));
  ipcMain.handle('conversation:clear', (_event, conversationId) => store.clearConversationMessages(conversationId));
  ipcMain.handle('conversation:update-meta', (_event, payload) => store.updateConversationMeta(payload));
  ipcMain.handle('message:send', (_event, payload) => store.sendMessage(payload));
  ipcMain.handle('message:update', (_event, payload) => store.updateMessage(payload));
  ipcMain.handle('message:delete', (_event, payload) => store.deleteMessage(payload));
  ipcMain.handle('message:quote', (_event, payload) => store.quoteMessage(payload));
  ipcMain.handle('message:comment', (_event, payload) => store.commentMessage(payload));
  ipcMain.handle('message:toggle-like', (_event, payload) => store.toggleLike(payload));
  ipcMain.handle('asset:import-file', (_event, payload) => store.importRendererFile(payload));
  ipcMain.handle('asset:import-files', (_event, payload) => store.importRendererFiles(payload));
  ipcMain.handle('asset:open', (_event, target) => openWithDefaultApp(target));
  ipcMain.handle('sorting:get', () => store.getSortingWorkspace());
  ipcMain.handle('sorting:save', (_event, payload) => store.saveSortingWorkspace(payload));
  ipcMain.handle('sorting:move', (_event, payload) => store.moveSorting(payload));
  ipcMain.handle('sorting:update', (_event, payload) => store.updateSorting(payload));
  ipcMain.handle('link-preview:get', (_event, url) => linkPreviewService.get(url));
  ipcMain.handle('ai:refine', (_event, payload) => aiService.runRefine(payload));
  ipcMain.handle('ai:filter', (_event, payload) => aiService.runFilter(payload));
  ipcMain.handle('ai:trigger-conversation-bots', (_event, payload) => aiService.enqueueConversationBots(payload));
  ipcMain.handle('ai:trigger-machine-run', (_event, payload) => aiService.triggerMachineRun(payload));
  ipcMain.handle('ai:cancel-machine-run', (_event, payload) => aiService.cancelMachineRun(payload));
  ipcMain.handle('settings:list-ai-providers', () => store.listAiProviders());
  ipcMain.handle('settings:save-ai-provider', (_event, payload) => store.saveAiProvider(payload));
  ipcMain.handle('settings:list-bots', (_event, payload) => store.listBots(payload));
  ipcMain.handle('settings:list-bot-conversations', (_event, botId) => store.listBotConversations(botId));
  ipcMain.handle('settings:save-bot', (_event, payload) => store.saveBot(payload));
  ipcMain.handle('settings:get-user-profile', () => store.getUserProfile());
  ipcMain.handle('settings:save-user-profile', (_event, payload) => store.saveUserProfile(payload));
  ipcMain.handle('bots:ensure-direct-conversation', (_event, botId) => store.ensureDirectBotConversation(botId));
  ipcMain.handle('conversation:save-bot-binding', (_event, payload) => {
    store.saveConversationBotBinding(payload);
    return store.listBots({ conversationId: payload?.conversationId });
  });
  ipcMain.handle('system:get-info', () => ({
    runtime: 'desktop',
    dataRoot: store.dataRoot,
    dbPath: store.dbPath,
    cwd: process.cwd(),
  }));
}

process.on('message', (message) => {
  if (message !== 'electron-vite&type=hot-reload') return;

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.reload();
  }
});

app.setName('PaoPao');

app.whenReady().then(() => {
  const dataRoot = path.join(app.getPath('userData'), 'paopao-data');
  secretStore = new SecretStore({ dataRoot });
  secretStore.initialize();
  store = new LocalDataStore({
    dataRoot,
    legacyDataDir: getLegacyDataDir(),
    secretStore,
  });
  store.initialize();
  linkPreviewService = new LinkPreviewService();
  aiService = new AiService(store, {
    emitConversationBotStreamEvent: (payload) => emitRendererEvent('ai:conversation-bot-stream', payload),
    emitMachineRunStreamEvent: (payload) => emitRendererEvent('ai:machine-run-stream', payload),
  });

  registerAssetProtocol();
  registerIpcHandlers();
  applyMacDockIcon();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
