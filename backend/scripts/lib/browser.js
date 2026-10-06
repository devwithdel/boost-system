/**
 * Headless Edge over the Chrome DevTools Protocol.
 *
 * No browser-automation package is installed and none is needed: this drives the
 * Edge that is already on the machine, using Node's built-in WebSocket. Shared
 * by scripts/screenshots.js and scripts/render-diagrams.js.
 *
 *   const { launch, CDP } = require("./lib/browser");
 *   const { browser, targetUrl } = await launch();
 *   const cdp = await CDP.attach(targetUrl);
 */
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const found = EDGE_CANDIDATES.find((p) => require("fs").existsSync(p));
  if (!found) throw new Error("No Edge or Chrome found in: " + EDGE_CANDIDATES.join(", "));
  return found;
}

/** Start a headless browser with the debugger open, and wait for it to answer. */
async function launch({ port = 9222, width = 1440, height = 900 } = {}) {
  const bin = findBrowser();
  const profile = path.join(os.tmpdir(), "boost-shot-" + Date.now());
  const child = spawn(
    bin,
    [
      "--headless=new",
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + profile,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=" + width + "," + height,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/json/version");
      if (r.ok) return { child, profile, port, width, height };
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  child.kill();
  throw new Error("Browser did not expose a debugging port");
}

/** Minimal CDP client over the built-in WebSocket. */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
    });
  }
  static async attach(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("CDP socket failed")), { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  /** Evaluate in the page and return the value. */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "evaluate threw");
    return r.result && r.result.value;
  }
  /** Navigate and resolve once the load event has fired. */
  async goto(url, timeoutMs = 30000) {
    const loaded = new Promise((resolve) => {
      const handler = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.method === "Page.loadEventFired") {
          this.ws.removeEventListener("message", handler);
          resolve();
        }
      };
      this.ws.addEventListener("message", handler);
    });
    await this.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(timeoutMs)]);
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

/** Wait for the browser to expose a page target to attach to. */
async function firstPageTarget(port = 9222) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch("http://127.0.0.1:" + port + "/json/list");
    const list = await r.json();
    const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (page) return page.webSocketDebuggerUrl;
    await sleep(250);
  }
  throw new Error("no page target appeared");
}

/** Open a session with Page and Network domains enabled. */
async function attach(port = 9222) {
  const cdp = await CDP.attach(await firstPageTarget(port));
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  return cdp;
}

async function screenshot(cdp, file) {
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  });
  require("fs").writeFileSync(file, Buffer.from(shot.data, "base64"));
}

async function shutdown({ child, profile }) {
  try {
    child.kill();
  } catch {
    /* already dead */
  }
  // The browser holds its profile open briefly after the kill, so a failure
  // here is cosmetic.
  try {
    require("fs").rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* temp profile left behind; harmless */
  }
}

module.exports = { launch, attach, CDP, firstPageTarget, screenshot, shutdown, sleep };