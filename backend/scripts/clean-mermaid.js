/**
 * Remove presentational HTML from the Mermaid sources.
 *
 * `<i>` and `<b>` are decoration only, and they are the tags renderers disagree
 * about: GitHub's Mermaid rejects or blanks diagrams containing them. `<br/>` is
 * kept, because it is how a label spans lines and is supported everywhere.
 *
 * Idempotent: running it again changes nothing.
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "docs", "diagrams", "src");

let touched = 0;
for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith(".mmd"))) {
  const full = path.join(SRC, file);
  const before = fs.readFileSync(full, "utf8");
  const after = before.replace(/<\/?[ib]>/g, "");
  if (after !== before) {
    fs.writeFileSync(full, after);
    touched++;
    console.log("  cleaned " + file);
  }
}
console.log(touched ? touched + " file(s) cleaned." : "already clean.");