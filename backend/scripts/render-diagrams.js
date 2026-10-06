/**
 * Render the Mermaid diagrams in docs/architecture.md to PNG.
 *
 * Reuses scripts/lib/browser.js, so no automation package is required. Mermaid
 * itself is loaded from a CDN inside the generated page — it is a build-time
 * documentation aid, not something the app depends on.
 *
 *   node scripts/render-diagrams.js
 *
 * Also acts as the syntax check: a diagram that Mermaid cannot parse is
 * reported as a failure rather than silently producing an empty image.
 */
const fs = require("fs");
const path = require("path");
const { launch, attach, screenshot, shutdown, sleep } = require("./lib/browser");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE = path.join(ROOT, "docs", "architecture.md");
const OUT = path.join(ROOT, "docs", "diagrams");
const PORT = 9223;

const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

/** Pull every ```mermaid block out, with the heading that introduces it. */
function extractDiagrams(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let heading = "";
  let inBlock = false;
  let buf = [];

  for (const line of lines) {
    if (!inBlock) {
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) heading = h[1].trim();
      if (/^```mermaid\s*$/.test(line)) {
        inBlock = true;
        buf = [];
      }
      continue;
    }
    if (/^```\s*$/.test(line)) {
      out.push({ heading, source: buf.join("\n") });
      inBlock = false;
      continue;
    }
    buf.push(line);
  }
  return out;
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** A page that renders one diagram and reports success or the parse error. */
function page(source, title) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${title}</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  body { padding: 20px; font-family: "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 17px; font-weight: 600; color: #334155; margin: 0 0 14px; }
  #diagram { display: inline-block; }
</style></head>
<body>
  <h1>BOOST &mdash; ${title}</h1>
  <div id="diagram"></div>
  <script src="${MERMAID_CDN}"></script>
  <script>
    window.__result = null;
    (async () => {
      try {
        mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" });
        const { svg } = await mermaid.render("d" + Date.now(), ${JSON.stringify(source)});
        document.getElementById("diagram").innerHTML = svg;
        const el = document.querySelector("#diagram svg");
        // Mermaid sizes the svg from its viewBox. Relying on the measured box
        // alone is unreliable — an svg with no width attribute falls back to
        // the 300px default replaced-element width — so pin it explicitly
        // first and measure that.
        const vb = (el.getAttribute("viewBox") || "").split(/[\\s,]+/).map(Number);
        const w = vb.length === 4 ? vb[2] : 0;
        const h = vb.length === 4 ? vb[3] : 0;
        if (w && h) {
          el.setAttribute("width", w);
          el.setAttribute("height", h);
          el.style.maxWidth = "none";
        }
        const box = el.getBoundingClientRect();
        window.__result = {
          ok: true,
          width: Math.ceil(w || box.width),
          height: Math.ceil(h || box.height),
          // Mermaid inlines its own styles, so the outerHTML stands alone.
          svg: el.outerHTML
        };
      } catch (err) {
        window.__result = { ok: false, error: String(err && err.message ? err.message : err) };
      }
    })();
  </script>
</body></html>`;
}

(async () => {
  if (!fs.existsSync(SOURCE)) throw new Error("missing " + SOURCE);
  fs.mkdirSync(OUT, { recursive: true });

  const diagrams = extractDiagrams(fs.readFileSync(SOURCE, "utf8"));
  if (!diagrams.length) throw new Error("no mermaid blocks found in " + SOURCE);
  console.log("Found " + diagrams.length + " diagram(s).");

  const browser = await launch({ port: PORT, width: 1800, height: 1200 });
  let cdp;
  let failed = 0;

  try {
    cdp = await attach(PORT);

    for (const d of diagrams) {
      const name = slug(d.heading);
      await cdp.goto("about:blank");
      await cdp.goto("data:text/html;charset=utf-8," + encodeURIComponent(page(d.source, d.heading)));

      // Wait for the async render to report back.
      let result = null;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        result = await cdp.eval("window.__result");
        if (result) break;
        await sleep(250);
      }

      if (!result) {
        console.log("  TIMEOUT " + name);
        failed++;
        continue;
      }
      if (!result.ok) {
        console.log("  PARSE ERROR " + name + "\n      " + result.error);
        failed++;
        continue;
      }

      // Vector first: it scales for print and weighs a few KB.
      const svgFile = path.join(OUT, name + ".svg");
      fs.writeFileSync(svgFile, result.svg);

      // Then a PNG cropped to the diagram. Capturing the fixed viewport instead
      // left the drawing in the corner of a mostly empty canvas, too small to
      // read once pasted into a document.
      const pad = 20;
      const header = 48;
      const width = result.width + pad * 2;
      const height = result.height + pad * 2 + header;
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: Math.max(width, 400),
        height: Math.max(height, 300),
        deviceScaleFactor: 2,
        mobile: false,
      });
      await sleep(300);

      const pngFile = path.join(OUT, name + ".png");
      await screenshot(cdp, pngFile);
      await cdp.send("Emulation.clearDeviceMetricsOverride");

      const svgKb = (fs.statSync(svgFile).size / 1024).toFixed(0);
      const pngKb = (fs.statSync(pngFile).size / 1024).toFixed(0);
      console.log("  ok   " + name.padEnd(22) + width + "x" + height + "  svg " + svgKb + "KB  png " + pngKb + "KB");
    }

    console.log("\n" + (diagrams.length - failed) + "/" + diagrams.length + " rendered to " + OUT);
    if (failed) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    await shutdown(browser);
  }
})().catch((err) => {
  console.error("render-diagrams failed:", err.message);
  process.exit(1);
});