/**
 * Screenshot every module for the research document.
 *
 * Drives the headless browser via scripts/lib/browser.js — no automation package
 * required.
 *
 *   node scripts/screenshots.js
 *
 * Writes docs/screenshots/<page>.png. Requires the app on port 4000 and the
 * seed account from backend/.env.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { launch, attach, screenshot, shutdown, sleep } = require("./lib/browser");

const BASE = process.env.QA_BASE || "http://localhost:4000";
const OUT = path.join(__dirname, "..", "..", "docs", "screenshots");
const PORT = 9222;

// Viewport is fixed so every image is the same size and comparable in a doc.
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };

const PAGES = [
  ["dashboard", "/dashboard"],
  ["requests", "/requests"],
  ["quotations", "/quotations"],
  ["orders", "/orders"],
  ["documents", "/documents"],
  ["bidding", "/bidding"],
  ["reports", "/reports"],
  ["scanner", "/scanner"],
  ["settings", "/settings"],
];
const PUBLIC_PAGES = [["login", "/login"]];

/** Log in over HTTP and return the session cookie as {name, value}. */
async function loginCookie() {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;
  if (!email || !password) throw new Error("SEED_EMAIL / SEED_PASSWORD must be set in backend/.env");

  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
  });
  if (!res.ok) throw new Error("login failed: " + res.status);

  const jar = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!jar) throw new Error("login returned no cookie");

  const eq = jar.indexOf("=");
  return { name: jar.slice(0, eq), value: jar.slice(eq + 1) };
}

/**
 * The shell is built by JavaScript, so "loaded" is not enough. Wait until the
 * module has actually drawn: a populated #page, no spinner, no table skeleton.
 */
async function waitForRender(cdp, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await cdp.eval(`(() => {
      const page = document.getElementById("page");
      // The auth pages have no app shell, so they are ready as soon as they
      // have drawn anything at all.
      if (!page) return document.body.children.length > 3;
      if (!page.children.length) return false;
      if (document.querySelector(".spinner")) return false;
      if (document.querySelector(".dt-skel")) return false;
      return true;
    })()`);
    if (ready) return true;
    await sleep(200);
  }
  return false;
}

async function shoot(cdp, name, url, cookie) {
  await cdp.send("Emulation.setDeviceMetricsOverride", VIEWPORT);
  if (cookie) {
    await cdp.send("Network.setCookie", {
      name: cookie.name,
      value: cookie.value,
      domain: "localhost",
      path: "/",
    });
  }

  await cdp.goto(BASE + url);
  const rendered = await waitForRender(cdp);
  // Let fonts settle so text is not captured mid-swap.
  await sleep(700);

  await screenshot(cdp, path.join(OUT, name + ".png"));
  return {
    rendered,
    title: await cdp.eval("document.title"),
    h1: await cdp.eval("(document.querySelector('.topbar h1')||{}).textContent || ''"),
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const cookie = await loginCookie();
  const browser = await launch({ port: PORT, width: VIEWPORT.width, height: VIEWPORT.height });

  let cdp;
  try {
    cdp = await attach(PORT);

    const results = [];
    for (const [name, url] of PUBLIC_PAGES) {
      results.push([name, url, await shoot(cdp, name, url, null)]);
    }
    for (const [name, url] of PAGES) {
      results.push([name, url, await shoot(cdp, name, url, cookie)]);
    }

    console.log("");
    for (const [name, url, r] of results) {
      const size = fs.statSync(path.join(OUT, name + ".png")).size;
      console.log(
        "  " + (r.rendered ? "ok   " : "SLOW ") + name.padEnd(12) +
          (size / 1024).toFixed(0).padStart(5) + "KB   " + url + "   " + (r.h1 || r.title)
      );
    }
    console.log("\n" + results.length + " screenshots written to " + OUT);
  } finally {
    if (cdp) cdp.close();
    await shutdown(browser);
  }
})().catch((err) => {
  console.error("screenshots failed:", err.message);
  process.exit(1);
});