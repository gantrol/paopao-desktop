import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build, defineConfig, mergeConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const rendererRoot = path.join(desktopRoot, "renderer");
const defaultRendererDevUrl = new URL(
  process.env.PAOPAO_RENDERER_URL || "http://127.0.0.1:5180",
);
const electronBinary = createRequire(import.meta.url)("electron");
const devAppName = "PaoPao"; // 想显示“泡泡”就改这里
let electronProcess = null;
let electronCleanupInstalled = false;

function replacePlistStringValue(plist, key, value) {
  const pattern = new RegExp(
    `(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`,
  );
  if (pattern.test(plist)) {
    return plist.replace(pattern, `$1${value}$3`);
  }
  return plist.replace(
    "</dict>",
    `  <key>${key}</key>\n  <string>${value}</string>\n</dict>`,
  );
}

function ensureMacDevElectronBinary() {
  if (process.platform !== "darwin") return electronBinary;

  const sourceAppPath = path.resolve(electronBinary, "..", "..", "..");

  const devAppRoot = path.join(desktopRoot, ".vite-electron");
  const targetAppPath = path.join(devAppRoot, `${devAppName}.app`);
  const targetInfoPlistPath = path.join(
    targetAppPath,
    "Contents",
    "Info.plist",
  );
  const targetBinaryPath = path.join(
    targetAppPath,
    "Contents",
    "MacOS",
    "Electron",
  );
  const targetFrameworkPath = path.join(
    targetAppPath,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
  );

  fs.mkdirSync(devAppRoot, { recursive: true });

  const needsFreshCopy =
    !fs.existsSync(targetBinaryPath) ||
    !fs.existsSync(targetInfoPlistPath) ||
    !fs.existsSync(targetFrameworkPath);

  if (needsFreshCopy) {
    fs.rmSync(targetAppPath, { recursive: true, force: true });
    fs.cpSync(sourceAppPath, targetAppPath, { recursive: true });
  }

  let plist = fs.readFileSync(targetInfoPlistPath, "utf8");
  plist = replacePlistStringValue(plist, "CFBundleDisplayName", devAppName);
  plist = replacePlistStringValue(plist, "CFBundleName", devAppName);
  plist = replacePlistStringValue(
    plist,
    "CFBundleIdentifier",
    "com.paopao.desktop.dev",
  );

  const iconIcnsPath = path.join(desktopRoot, "build", "icon.icns");
  if (fs.existsSync(iconIcnsPath)) {
    const targetIcnsName = "paopao-dev.icns";
    const targetIcnsPath = path.join(
      targetAppPath,
      "Contents",
      "Resources",
      targetIcnsName,
    );
    fs.copyFileSync(iconIcnsPath, targetIcnsPath);
    plist = replacePlistStringValue(plist, "CFBundleIconFile", targetIcnsName);
  }

  fs.writeFileSync(targetInfoPlistPath, plist, "utf8");
  return targetBinaryPath;
}

const devElectronBinary = ensureMacDevElectronBinary();

function buildRendererCsp({ isDev, includeFrameAncestors }) {
  const connectSrc = ["'self'"];
  const scriptSrc = ["'self'"];
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "img-src 'self' data: blob: paopao-asset: http: https:",
    "media-src 'self' data: blob: paopao-asset: http: https:",
    "object-src 'none'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ];

  if (isDev) {
    const hmrOrigin = defaultRendererDevUrl.origin;
    const hmrSocketOrigin = `${defaultRendererDevUrl.protocol === "https:" ? "wss:" : "ws:"}//${defaultRendererDevUrl.host}`;

    connectSrc.push(hmrOrigin, hmrSocketOrigin);
    // Vite's React Fast Refresh preamble is injected as an inline module script in dev.
    scriptSrc.push("'unsafe-inline'");
  }

  if (includeFrameAncestors) {
    directives.push("frame-ancestors 'none'");
  }

  directives.push(`script-src ${scriptSrc.join(" ")}`);
  directives.push(`connect-src ${connectSrc.join(" ")}`);

  return directives.join("; ");
}

function rendererCspPlugin() {
  let isDev = false;

  return {
    name: "paopao-renderer-csp",
    configResolved(config) {
      isDev = config.command === "serve";
    },
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: buildRendererCsp({ isDev, includeFrameAncestors: false }),
          },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

function withExternalBuiltins(config) {
  const builtins = builtinModules.filter((name) => !name.startsWith("_"));
  const external = [
    "electron",
    ...builtins,
    ...builtins.map((name) => `node:${name}`),
  ];
  const currentExternal = config.build?.rollupOptions?.external;

  if (Array.isArray(currentExternal)) {
    config.build.rollupOptions.external = [...external, ...currentExternal];
    return config;
  }

  if (
    typeof currentExternal === "string" ||
    currentExternal instanceof RegExp
  ) {
    config.build.rollupOptions.external = [...external, currentExternal];
    return config;
  }

  if (typeof currentExternal === "function") {
    config.build.rollupOptions.external = (source, importer, isResolved) => {
      if (external.includes(source)) return true;
      return currentExternal(source, importer, isResolved);
    };
    return config;
  }

  config.build ??= {};
  config.build.rollupOptions ??= {};
  config.build.rollupOptions.external = external;
  return config;
}

function createElectronBuildConfig({ outDir, watch }) {
  return {
    configFile: false,
    root: desktopRoot,
    publicDir: false,
    define: {
      "process.env": "process.env",
    },
    resolve: {
      conditions: ["node"],
      mainFields: ["module", "jsnext:main", "jsnext"],
    },
    build: {
      outDir,
      emptyOutDir: true,
      minify: watch ? false : undefined,
      watch: watch ? {} : null,
      reportCompressedSize: false,
    },
  };
}

function createMainBuildConfig({ watch, onRebuild }) {
  const config = mergeConfig(
    createElectronBuildConfig({
      outDir: path.join(desktopRoot, "dist/main"),
      watch,
    }),
    {
      build: {
        ssr: path.join(desktopRoot, "main/index.js"),
        rollupOptions: {
          output: {
            format: "cjs",
            entryFileNames: "index.js",
            chunkFileNames: "chunks/[name].js",
            assetFileNames: "assets/[name].[ext]",
          },
        },
      },
      plugins: onRebuild
        ? [
            {
              name: "paopao-main-restart",
              closeBundle() {
                return onRebuild();
              },
            },
          ]
        : [],
    },
  );

  return withExternalBuiltins(config);
}

function createPreloadBuildConfig({ watch, onRebuild }) {
  const config = mergeConfig(
    createElectronBuildConfig({
      outDir: path.join(desktopRoot, "dist/preload"),
      watch,
    }),
    {
      build: {
        ssr: path.join(desktopRoot, "main/preload.js"),
        rollupOptions: {
          output: {
            format: "cjs",
            inlineDynamicImports: true,
            entryFileNames: "index.js",
            chunkFileNames: "chunks/[name].js",
            assetFileNames: "assets/[name].[ext]",
          },
        },
      },
      plugins: onRebuild
        ? [
            {
              name: "paopao-preload-reload",
              closeBundle() {
                return onRebuild();
              },
            },
          ]
        : [],
    },
  );

  return withExternalBuiltins(config);
}

function stopElectronApp() {
  if (!electronProcess) return Promise.resolve();

  return new Promise((resolve) => {
    const processToStop = electronProcess;
    electronProcess = null;
    processToStop.once("exit", () => resolve());
    processToStop.kill("SIGTERM");
  });
}

async function startElectronApp() {
  if (!electronCleanupInstalled) {
    electronCleanupInstalled = true;
    process.once("exit", () => {
      electronProcess?.kill("SIGTERM");
    });
  }

  await stopElectronApp();

  electronProcess = spawn(devElectronBinary, [".", "--no-sandbox"], {
    cwd: desktopRoot,
    stdio:
      process.platform === "linux"
        ? ["inherit", "inherit", "inherit", "ignore", "ipc"]
        : ["inherit", "inherit", "inherit", "ipc"],
    env: {
      ...process.env,
    },
  });

  electronProcess.once("exit", () => {
    electronProcess = null;
  });
}

function electronHotPlugin() {
  let devMainWatcher = null;
  let devPreloadWatcher = null;

  return [
    {
      name: "paopao-electron-hot-dev",
      apply: "serve",
      configureServer(server) {
        server.httpServer?.once("listening", () => {
          process.env.VITE_DEV_SERVER_URL =
            server.resolvedUrls?.local[0] || defaultRendererDevUrl.toString();

          let rebuildCount = 0;
          const isInitialBuild = () => rebuildCount < 2;

          const onMainRebuild = async () => {
            rebuildCount += 1;
            if (isInitialBuild()) return;
            await startElectronApp();
          };

          const onPreloadRebuild = async () => {
            rebuildCount += 1;
            if (isInitialBuild()) return;

            if (!electronProcess) {
              await startElectronApp();
              return;
            }

            server.ws.send({ type: "full-reload" });
            electronProcess.send?.("electron-vite&type=hot-reload");
          };

          Promise.all([
            build(
              createMainBuildConfig({
                watch: true,
                onRebuild: onMainRebuild,
              }),
            ),
            build(
              createPreloadBuildConfig({
                watch: true,
                onRebuild: onPreloadRebuild,
              }),
            ),
          ])
            .then(([mainWatcher, preloadWatcher]) => {
              devMainWatcher = mainWatcher;
              devPreloadWatcher = preloadWatcher;
            })
            .catch((error) => {
              server.config.logger.error(error.stack || String(error));
            });
        });

        server.httpServer?.once("close", async () => {
          await Promise.all([
            devMainWatcher?.close?.(),
            devPreloadWatcher?.close?.(),
          ]);
          await stopElectronApp();
        });
      },
    },
    {
      name: "paopao-electron-hot-build",
      apply: "build",
      async closeBundle() {
        await build(createMainBuildConfig({ watch: false }));
        await build(createPreloadBuildConfig({ watch: false }));
      },
    },
  ];
}

export default defineConfig(async ({ command }) => ({
  base: command === "build" ? "./" : "/",
  root: rendererRoot,
  publicDir: path.join(desktopRoot, "public"),
  plugins: [
    react(),
    tailwindcss(),
    rendererCspPlugin(),
    ...electronHotPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.join(desktopRoot, "renderer/src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    headers: {
      "Content-Security-Policy": buildRendererCsp({
        isDev: true,
        includeFrameAncestors: true,
      }),
    },
  },
  build: {
    outDir: path.join(desktopRoot, "dist/renderer"),
    emptyOutDir: true,
  },
}));
