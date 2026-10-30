"use strict";
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");

// ─── Single Instance Lock ───────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let server = null;
let window = null;

app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

// ─── Security constants ───────────────────────────────────────────────────────

// The POS server is always bound to loopback. This is the only origin the
// renderer is permitted to navigate to. Any other navigation is denied.
const LOCALHOST_ORIGINS = [
  "http://127.0.0.1",
  "http://localhost",
  "http://[::1]",
];

// External URLs the "open in browser" action is allowed to open. Keep minimal.
// Update only when a legitimate external link (e.g. vendor website) is needed.
const ALLOWED_EXTERNAL_PREFIXES = [
  "https://selwickpos.com",
  "https://selwick.com",
];

function isLocalhostUrl(url) {
  try {
    const parsed = new URL(url);
    return LOCALHOST_ORIGINS.some((o) => url.startsWith(o)) ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
  } catch {
    return false;
  }
}

function isAllowedExternal(url) {
  return ALLOWED_EXTERNAL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve(true);
      else resolve(false);
    });
    tester.once("listening", () => {
      tester.close(() => resolve(false));
    });
    tester.listen(port, "127.0.0.1");
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, child, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`Next.js server exited (${child.exitCode}).`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.status < 500) return;
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for the local POS server.");
}

async function start() {
  let url;
  if (!app.isPackaged) {
    app.setName("Selwick POS Dev");
    const defaultUrl = "http://127.0.0.1:3000";
    url = process.env.SELWICK_DEV_URL || defaultUrl;
    let isRunning = false;
    try {
      const probe = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (probe.status < 500) isRunning = true;
    } catch {
      if (!process.env.SELWICK_DEV_URL) {
        try {
          const probeLocal = await fetch("http://localhost:3000", { signal: AbortSignal.timeout(1000) });
          if (probeLocal.status < 500) {
            url = "http://localhost:3000";
            isRunning = true;
          }
        } catch {
          isRunning = false;
        }
      }
    }

    if (!isRunning && !process.env.SELWICK_DEV_URL) {
      const projectRoot = path.join(__dirname, "..");
      const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
      if (fs.existsSync(nextBin)) {
        server = spawn(process.execPath, [nextBin, "dev"], {
          cwd: projectRoot,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            NODE_OPTIONS: "--experimental-sqlite",
            SELWICK_ENV: "desktop-dev",
            SELWICK_USER_DATA_PATH: app.getPath("userData"),
          },
          stdio: "inherit",
        });
        server.once("error", err => console.error("Next.js dev server failed:", err));
      }
    }
    await waitForServer(url, server);
  } else {
    const serverFile = path.join(process.resourcesPath, "server", "server.js");
    if (!fs.existsSync(serverFile)) throw new Error(`Bundled Next.js server missing: ${serverFile}`);
    let port = 3456;
    if (await isPortInUse(port)) {
      port = await freePort();
    }
    url = `http://127.0.0.1:${port}`;
    // Security hygiene: desktop POS client must never inherit license server private keys or admin secrets
    const clientEnv = { ...process.env };
    delete clientEnv.SELWICK_LICENSE_PRIVATE_KEY;
    delete clientEnv.SELWICK_LICENSE_ADMIN_SECRET;

    server = spawn(process.execPath, [serverFile], {
      cwd: path.dirname(serverFile),
      env: {
        ...clientEnv,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        NODE_OPTIONS: "--experimental-sqlite",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        SELWICK_ENV: "production",
        SELWICK_USER_DATA_PATH: app.getPath("userData"),
        SELWICK_LICENSE_SERVER_URL: process.env.SELWICK_LICENSE_SERVER_URL || "https://license.selwick.com",
      },
      windowsHide: true,
      stdio: "ignore",
    });
    server.once("error", err => console.error("Local server failed:", err));
    await waitForServer(url, server);
  }
  window = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1024, minHeight: 700,
    backgroundColor: "#ffffff", title: "Selwick POS",
    icon: path.join(__dirname, "selwick-icon.ico"),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });

  // ─── Permissions ─────────────────────────────────────────────────────────────
  // Allow the File System Access API permission state to be resolved for the
  // local POS origin. Scheduled backups do not show a permission prompt.
  // All other permission requests (camera, microphone, geolocation, etc.) are denied.
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === "fileSystem") {
      callback(true);
      return;
    }
    callback(false);
  });

  // ─── Pop-up / window.open handler ────────────────────────────────────────────
  // Deny all renderer-initiated new window opens by default.
  // Only whitelisted external URLs are forwarded to the system browser.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isAllowedExternal(target)) {
      shell.openExternal(target).catch(() => {});
    }
    // Everything else (including arbitrary http/https) is denied.
    return { action: "deny" };
  });

  // ─── Navigation guard (will-navigate) ────────────────────────────────────────
  // Prevents the renderer from navigating away from the localhost POS origin.
  // This blocks phishing via <a href="..."> or malicious redirects.
  window.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!isLocalhostUrl(navigationUrl)) {
      event.preventDefault();
      // Optionally open safe external links in the system browser.
      if (isAllowedExternal(navigationUrl)) {
        shell.openExternal(navigationUrl).catch(() => {});
      }
    }
  });

  // ─── Redirect guard (will-redirect) ──────────────────────────────────────────
  // Prevents server-initiated redirects to non-localhost URLs.
  window.webContents.on("will-redirect", (event, redirectUrl) => {
    if (!isLocalhostUrl(redirectUrl)) {
      event.preventDefault();
    }
  });

  // ─── Production DevTools lockdown ────────────────────────────────────────────
  // DevTools must not be accessible in a packaged production build.
  if (app.isPackaged) {
    window.webContents.on("devtools-opened", () => {
      window.webContents.closeDevTools();
    });
  }

  // ─── Renderer Crash & Unresponsive Guard ────────────────────────────────────
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process crashed:", details);
  });
  window.on("unresponsive", () => {
    console.warn("BrowserWindow became unresponsive");
  });

  await window.loadURL(url);
}

function stopServer() {
  if (server && server.exitCode === null) {
    try {
      if (process.platform === "win32" && server.pid) {
        spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        server.kill();
      }
    } catch {
      // server already terminated
    }
    server = null;
  }
}

process.on("SIGINT", () => {
  stopServer();
  app.quit();
});
process.on("SIGTERM", () => {
  stopServer();
  app.quit();
});

app.whenReady().then(() => start().catch(err => {
  console.error(err);
  dialog.showErrorBox("Selwick POS startup error", err.message);
  app.quit();
}));
app.on("window-all-closed", () => {
  stopServer();
  app.quit();
});
app.on("before-quit", () => {
  stopServer();
});