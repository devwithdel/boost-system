/**
 * Downloads the Tesseract language data used by the mobile scanner.
 * Only needed once after cloning:
 *
 *   npm run ocr:setup
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const LANG = process.env.OCR_LANG || "eng";
const DIR = path.join(__dirname, "..", "langdata");
const URL_TEMPLATE = `https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0_fast/${LANG}.traineddata.gz`;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const target = path.join(DIR, `${LANG}.traineddata.gz`);

  if (fs.existsSync(target)) {
    console.log(`OCR language data already present: ${target}`);
    return;
  }

  await download(URL_TEMPLATE, target);
  const mb = (fs.statSync(target).size / (1024 * 1024)).toFixed(1);
  console.log(`Downloaded ${LANG} language data (${mb} MB) to ${target}`);
})().catch((err) => {
  console.error("OCR setup failed:", err.message);
  process.exit(1);
});