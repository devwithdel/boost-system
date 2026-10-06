/**
 * Replace the ```mermaid blocks in docs/architecture.md with embedded SVG images,
 * and write the Mermaid source out as one .mmd file per diagram.
 *
 * Why: GitHub renders Mermaid in markdown with a stricter configuration, and the
 * HTML tags these diagrams use inside node labels (<i>, <b>) do not survive it —
 * the blocks come out blank or as an error. Embedding the pre-rendered SVG always
 * displays, and the .mmd files give Lucidchart something to paste.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DOC = path.join(ROOT, "docs", "architecture.md");
const SRC = path.join(ROOT, "docs", "diagrams", "src");

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const lines = fs.readFileSync(DOC, "utf8").split(/\r?\n/);
const out = [];
let heading = "";
let i = 0;
let written = 0;

fs.mkdirSync(SRC, { recursive: true });

while (i < lines.length) {
  const line = lines[i];
  const h = /^#{1,6}\s+(.*)$/.exec(line);
  if (h) heading = h[1].trim();

  if (!/^```mermaid\s*$/.test(line)) {
    out.push(line);
    i++;
    continue;
  }

  // Collect the block.
  const buf = [];
  i++;
  while (i < lines.length && !/^```\s*$/.test(lines[i])) {
    buf.push(lines[i]);
    i++;
  }
  i++; // closing fence

  const name = slug(heading);
  const source = buf.join("\n");
  const file = path.join(SRC, name + ".mmd");
  fs.writeFileSync(file, source + "\n");
  written++;

  out.push(`![${heading}](diagrams/${name}.svg)`);
  out.push("");
  out.push(
    `<sub>Mermaid source: [diagrams/src/${name}.mmd](diagrams/src/${name}.mmd)` +
      ` &middot; also as [PNG](diagrams/${name}.png)</sub>`
  );
}

fs.writeFileSync(DOC, out.join("\n"));
console.log("Rewrote " + DOC);
console.log("Wrote " + written + " .mmd file(s) to " + SRC);
written && console.log(out.filter((l) => /^!\[/.test(l)).join("\n"));