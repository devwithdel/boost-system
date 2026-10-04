const path = require("path");
const { createWorker } = require("tesseract.js");

const LANG_DIR = path.join(__dirname, "..", "langdata");
const LANG = process.env.OCR_LANG || "eng";

let workerPromise = null;

// Hard stop for a single scan. Without it a wedged worker leaves the request
// hanging and the browser spinning forever.
const OCR_TIMEOUT_MS = 120000;

function isReady() {
  return true; // language data ships with the repo in backend/langdata
}

/**
 * tesseract.js reports an unreadable image by calling `throw` from inside its
 * own message handler. Node turns that into an uncaught exception and the whole
 * server dies — one corrupt upload took procurement offline. Passing the
 * `errorHandler` option diverts that failure to us instead, so it becomes an
 * ordinary rejected promise the route can answer with a 400.
 */
function createOcrWorker() {
  return createWorker(LANG, 1, {
    langPath: LANG_DIR,
    cachePath: LANG_DIR,
    gzip: true,
    logger: () => {},
    errorHandler: (err) => {
      console.error("OCR engine reported:", (err && err.message) || err);
    },
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Throw away the current worker so the next scan builds a fresh one. */
async function resetWorker() {
  const pending = workerPromise;
  workerPromise = null;
  const worker = await pending.catch(() => null);
  if (worker) await worker.terminate().catch(() => {});
}

/** Release the WASM worker on shutdown. */
async function shutdown() {
  await resetWorker();
}

/* Image type sniffing. Cheap, and it stops obviously-corrupt files from
   reaching the engine at all. */
const SIGNATURES = [
  ["jpeg", (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["png", (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a],
  ["gif", (b) => b.length > 6 && b.slice(0, 3).toString("latin1") === "GIF"],
  ["bmp", (b) => b.length > 2 && b[0] === 0x42 && b[1] === 0x4d],
  ["webp", (b) => b.length > 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP"],
];

/** "png" / "jpeg" / … or null when the bytes are not an image at all. */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  for (const [type, test] of SIGNATURES) {
    if (test(buffer)) return type;
  }
  return null;
}

const KIND_LABELS = {
  request: "Procurement request",
  quotation: "Quotation",
  order: "Purchase order",
  invoice: "Invoice / receipt",
  award: "Notice of award",
  canvass: "Canvass",
  resolution: "BAC resolution",
  other: "Other / unrecognised",
};

function detectKind(text) {
  const t = text.toLowerCase();

  // Specific titles win, most specific first.
  // NOTE: do not match a bare \bbid\b here. Award notices say "Lowest
  // Calculated Responsive Bid (LCRB)", which used to file every Notice of
  // Award as a quotation.
  if (/\bnotice\s*of\s*award\b|\bnoa\b/.test(t)) return "award";
  if (/\bpurchase\s*order\b|\bp\.?\s?o\.?\s*(?:no|number)\b/.test(t)) return "order";
  if (/\bbac\s*resolution\b/.test(t)) return "resolution";
  if (/\bcanvass\b/.test(t)) return "canvass";
  if (/\bquotation\b|\bquote\s*(?:no\.?|number)?\b|\bbid\s+documents?\b|\bbidding\b/.test(t)) return "quotation";
  if (/\binvoice\b|\breceipt\b|\backnowledg/.test(t)) return "invoice";
  if (/\brequest\s*(?:for|number|no\.?)\b|\bpr[-\s]?\d/.test(t)) return "request";
  return "other";
}

/* ------------------------------------------------------------------ *
 * Money / row parsing
 *
 * Government forms are grid tables: the label is a column header and the
 * value sits several cells away, with rules OCR'd as junk in between.
 * Label-adjacent regexes therefore fail on real documents, so we parse
 * rows positionally instead.
 * ------------------------------------------------------------------ */

const MONEY_RE = /(?:₱|\bP)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;

// Characters that are table rules, never part of a value.
const EDGE_JUNK = /^[\s_\-~^[\]{}<>'"=;#\\|]+|[\s_\-~^[\]{}<>'"=;#\\|]+$/g;

const UNIT_WORDS =
  /^(pc|pcs|unit|units|box|boxes|set|sets|lot|lots|pack|packs|roll|rolls|kit|kg|kgs|g|l|ml|dozen|dozens|sack|sacks|each|per|head|tablet|tablets|bags?|bottles?)$/i;

// Lines that hold metadata or a document title, never purchasable items.
const ROW_SKIP =
  /\b(tin|ors|burs|funds|agency|supplier|address|place of delivery|delivery term|payment term|date|mode of procurement|pr\s*num|po\s*no|canvass\s*no|bac resolution|end-user|conforme|authorized official|accountant|funds available)\b/i;

const TITLE_SKIP =
  /\b(purchase\s+order|notice\s*of\s*award|statement\s+of|abstract\s+of|canvass|bac\s+resolution|request\s+for|quotation|invoice|delivery\s+schedule)\b/i;

// Every mask replaces the match with an equal number of spaces, so offsets
// stay identical between the money view and the description view.
const blank = (match) => " ".repeat(match.length);

// Dates, reference ids and phone numbers are never descriptions or amounts.
function maskRefs(line) {
  return line
    .replace(/\d{1,4}\s*[-\/]\s*\d{1,4}(?:\s*[-\/]\s*\d{1,4})?/g, blank)
    .replace(/\(?\b\d{3}\)?\s*\d{3}\s*[-–]\s*\d{4}\b/g, blank);
}

// Specs like "(32gb)" or "130MB/s" are not amounts, but "32gb" is part of
// the description, so these are only masked for money detection.
function maskUnits(line) {
  return line.replace(/\d+(?:\.\d+)?\s*(?:mb\/s|gb|mb|tb|kb|kg|kgs|ml|%|pcs?)\b/gi, blank);
}

function maskNoise(line) {
  return maskUnits(maskRefs(line));
}

/**
 * Every plausible number on a line, tagged with whether it actually looks
 * like money. "solid" means grouped, decimal or currency-marked — an area
 * code or a stock number is not an amount, so a row whose last value is not
 * solid is not a row. Plain integers are still kept, because that is how a
 * quantity is printed.
 */
function moneyTokens(line, maskedOverride) {
  const out = [];
  const masked = maskedOverride === undefined ? maskNoise(line) : maskedOverride;
  MONEY_RE.lastIndex = 0;

  let m;
  while ((m = MONEY_RE.exec(masked)) !== null) {
    const raw = m[1];
    const grouped = raw.indexOf(",") !== -1;
    const decimals = /\.\d{1,2}$/.test(raw);
    const currency = /^(?:₱|\bP\b|P)/.test(m[0]);
    const digits = raw.replace(/[^\d]/g, "").length;

    const solid = grouped || decimals || currency;
    if (!solid && digits < 2) continue; // stray single digits are never values

    const value = Number(raw.replace(/,/g, ""));
    if (!isFinite(value)) continue;
    out.push({ value, solid, index: m.index });
  }
  return out;
}

/**
 * One table row -> { item, quantity, unitPrice, amount }, or null.
 * Columns are read right to left: the last money value is the line amount,
 * the one before it the unit price, the one before that the quantity.
 */
function parseRow(line) {
  if (ROW_SKIP.test(line)) return null;
  if (TITLE_SKIP.test(line)) return null;

  // Work on the masked line throughout: token offsets must line up with the
  // text we later slice, otherwise the description gets cut in the wrong place.
  const masked = maskNoise(line);
  const money = moneyTokens(line, masked);
  if (money.length < 2) return null;

  // The right-most value must look like money. Without this, letterhead
  // lines such as "Tel. No. (088) 521-0440" parsed as a purchasable line.
  if (!money[money.length - 1].solid) return null;

  const amount = money[money.length - 1].value;
  const unitPrice = money.length > 1 ? money[money.length - 2].value : null;
  const quantity = money.length > 2 ? money[money.length - 3].value : null;

  if (amount <= 0) return null;
  if (unitPrice !== null && amount < unitPrice) return null; // columns out of order
  if (quantity !== null && quantity <= 0) return null;

  // Description: the longest cell that is neither numeric nor a bare unit.
  // Work on the slice of the line before the first money value so amounts
  // glued onto the name ("FLASH DRIVE (32gb) 890.00 11,570.00") are dropped.
  const head = money[0].index > 0 ? maskRefs(line).slice(0, money[0].index) : maskRefs(line);
  let item = null;
  for (const raw of head.split(/[|\t]/)) {
    const cell = raw.replace(EDGE_JUNK, "");
    if (!cell) continue;
    if (/^[\d.,\s₱P]+$/.test(cell)) continue;
    if (UNIT_WORDS.test(cell.trim())) continue;
    const letters = cell.replace(/[^A-Za-z]/g, "").length;
    if (letters < 3) continue;
    if (!item || cell.length > item.length) item = cell;
  }
  if (!item) return null;

  const clean = item
    .replace(/\(\s*\)|\[\s*\]/g, "") // brackets emptied by masking
    .replace(/\s+/g, " ")
    .replace(/\s+([),.;:])/g, "$1")
    .trim();

  return { item: clean, quantity, unitPrice, amount };
}

function findRows(text) {
  const rows = [];
  for (const line of String(text).split(/\n+/)) {
    const row = parseRow(line);
    if (row) rows.push(row);
    if (rows.length >= 25) break;
  }
  return rows;
}

/** Document total, with a record of where it came from. */
function findTotal(text, rows) {
  for (const line of String(text).split(/\n+/)) {
    if (!/\btotal\b/i.test(line)) continue;
    const money = moneyTokens(line);
    if (!money.length) continue;
    const value = money[money.length - 1].value;
    if (value > 0) return { value, source: "total-row" };
  }

  // "Eighty five thousand three hundred twenty pesos only... 85,320.00"
  const words =
    text.match(/pesos?\s+only[\s\S]{0,80}?(\d[\d,]*\.\d{2})/i) ||
    text.match(/amount\s+in\s+words[\s\S]{0,240}?(\d[\d,]*\.\d{2})/i);
  if (words) {
    const value = Number(words[1].replace(/,/g, ""));
    if (value > 0) return { value, source: "amount-in-words" };
  }

  const sum = rows.reduce((s, r) => s + r.amount, 0);
  if (sum > 0) return { value: sum, source: "line-items" };
  return null;
}

/**
 * Never hand the user a number we cannot corroborate. A total is only
 * trusted when the line items agree with it (either qty x unit price for a
 * single row, or the sum of the rows). A mismatch means the scanner read
 * something wrong, so the amount is withheld instead of guessed.
 */
function reconcile(rows, total) {
  if (!total) return { amount: null, ok: false, reason: "no-total" };

  const sum = rows.reduce((s, r) => s + r.amount, 0);

  if (rows.length === 1 && rows[0].quantity && rows[0].unitPrice) {
    const expect = rows[0].quantity * rows[0].unitPrice;
    if (Math.abs(expect - total.value) <= 1) {
      return { amount: total.value, ok: true, reason: "quantity x unit price" };
    }
  }

  if (rows.length && Math.abs(sum - total.value) <= Math.max(1, total.value * 0.01)) {
    return { amount: total.value, ok: true, reason: "line items" };
  }

  if (!rows.length) {
    // An explicit TOTAL row is reasonable evidence on its own, but it is
    // still uncorroborated, so the caller flags it for review.
    return { amount: total.value, ok: false, reason: "total-row-only" };
  }

  return { amount: null, ok: false, reason: "mismatch" };
}

/* ------------------------------------------------------------------ *
 * Label fields
 * ------------------------------------------------------------------ */

function labelValue(text, labels, opts) {
  // A delimiter is required by default: without one, "Department of Health"
  // on a letterhead reads as a department of "of Health".
  const joiner = opts && opts.looseDelimiter ? "[:\\-]?" : "[:\\-]";
  for (const line of String(text).split(/\n+/)) {
    const re = new RegExp("^\\s*(?:" + labels + ")\\s*" + joiner + "\\s*(.+?)\\s*$", "i");
    const m = line.match(re);
    if (!m || !m[1]) continue;
    const raw = m[1];
    const value = raw
      .replace(EDGE_JUNK, "")
      .replace(/\s+/g, " ")
      .trim();
    if (value) return { value, raw };
  }
  return null;
}

/**
 * Amount taken from a labelled form field ("Estimated Amount: 18,000.00").
 * Only money-shaped values count, so a garbled line such as
 * "Amount: 3S, y) \). dy 22" yields nothing instead of a stray digit.
 */
function labelledAmount(text) {
  for (const line of String(text).split(/\n+/)) {
    if (!/\b(?:estimated\s*)?(?:amount|total(?:\s*amount)?|value)\b/i.test(line)) continue;
    const solid = moneyTokens(line).filter((m) => m.solid);
    if (!solid.length) continue;
    const value = solid[solid.length - 1].value;
    if (value > 0) return value;
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

const DOC_DATE_RE =
  /\b(?:date\s*(?:issued|of\s*delivery|signed)?|dated)\s*[:\-]\s*([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})/i;

function findDocumentDate(text) {
  const labelled = labelValue(text, "date\\s*issued|document\\s*date|dated?");
  const fromLabel = labelled ? normaliseDate(labelled.value) : null;
  if (fromLabel) return fromLabel;

  const anywhere = text.match(DOC_DATE_RE);
  return anywhere ? normaliseDate(anywhere[1]) : null;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function normaliseDate(raw) {
  if (!raw) return null;
  const value = String(raw).trim();

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;

  const mdy = value.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (mdy) return `${mdy[3]}-${String(mdy[1]).padStart(2, "0")}-${String(mdy[2]).padStart(2, "0")}`;

  // "July 21, 2026"
  const named = value.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    if (month) return `${named[3]}-${String(month).padStart(2, "0")}-${String(named[2]).padStart(2, "0")}`;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Public extraction
 * ------------------------------------------------------------------ */

function extractFields(text) {
  const source = String(text || "");
  const kind = detectKind(source);
  const flags = {};
  const notices = [];

  const rows = findRows(source);
  const total = findTotal(source, rows);
  const money = reconcile(rows, total);

  /* ---- item / quantity ---- */
  let item = null;
  let quantity = null;

  if (rows.length === 1) {
    item = rows[0].item;
    quantity = rows[0].quantity;
  } else if (rows.length > 1) {
    item = rows.slice(0, 3).map((r) => r.item).join("; ");
    if (rows.length > 3) item += " (+" + (rows.length - 3) + " more)";
    const qtys = rows.map((r) => r.quantity).filter((q) => q !== null);
    if (qtys.length === rows.length) quantity = qtys.reduce((s, q) => s + q, 0);
  }

  if (!item) {
    const labelled = labelValue(source, "item(?:\\s*description)?|description|scope|purpose");
    if (labelled) {
      item = labelled.value;
      flags.item = "Read from the description label — check it is the item, not a heading.";
    }
  }

  // Fall back to a labelled quantity for forms that print "Quantity: 24"
  // instead of a table column.
  if (quantity === null) {
    const hit = source.match(/\b(?:quantity|qty)\s*[:\-]\s*(\d[\d,]*)\b/i);
    if (hit) quantity = toNumber(hit[1]);
  }

  if (!item) {
    flags.item = "Could not read the item. Fill this in from the document.";
    notices.push("No item or description could be read from this page.");
  }

  if (quantity === null) {
    flags.quantity = "No quantity could be read from this page.";
  }

  /* ---- amount ---- */
  // A total is only used when the page corroborates it. With line items
  // present they must agree; without them an explicitly labelled form field
  // is accepted, and a bare printed total is accepted but flagged.
  let estimatedAmount = null;
  let amountReason = "none";

  if (rows.length && total) {
    if (money.ok) {
      estimatedAmount = money.amount;
      amountReason = money.reason;
    } else {
      amountReason = "mismatch";
    }
  } else if (!rows.length) {
    const labelled = labelledAmount(source);
    if (labelled) {
      estimatedAmount = labelled;
      amountReason = "labelled";
    } else if (total) {
      estimatedAmount = total.value;
      amountReason = "total-row-only";
    }
  }

  if (amountReason === "mismatch") {
    flags.estimatedAmount =
      "The total on the page does not match the line items, so nothing was filled in. Enter the amount yourself.";
    notices.push("Could not verify the total — the line items disagree with the printed total.");
  } else if (amountReason === "none") {
    flags.estimatedAmount = "No total could be read. Enter the amount yourself.";
    notices.push("No total amount could be read from this page.");
  } else if (amountReason === "total-row-only") {
    flags.estimatedAmount = "Read from the printed total, but nothing on the page confirms it. Please check.";
  }

  /* ---- reference numbers ---- */
  let requestNumber = null;
  const REF_PATTERNS = [
    /\b(REQ[-\s]?\d[\w-]{2,})\b/i,
    /\b(PR[-\s]?\d[\w-]{2,})\b/i,
    /\b(?:pr|p\.r\.?)\s*(?:number|no\.?|numbe\w*)\s*[:\-]?\s*([A-Z0-9][\w-]{3,})/i,
    // OCR often glues the label to the next column: "PRnumbePRdate __ 26-04-0232"
    /\bpr\w*\s*[^\dA-Za-z]{0,15}(\d{2,4}\s*[-\/]\s*\d{2,4}\s*[-\/]\s*\d{2,4})/i,
  ];

  // Try every pattern, not just the first that matches: a glued label can
  // match with a digit-free capture ("PRdate") while a later pattern holds
  // the real number.
  for (const re of REF_PATTERNS) {
    const hit = source.match(re);
    if (!hit || !hit[1]) continue;
    const candidate = String(hit[1]).replace(/\s+/g, "");
    // A reference number must contain a digit.
    if (/\d/.test(candidate)) {
      requestNumber = candidate;
      break;
    }
  }
  if (requestNumber) {
    flags.requestNumber = "Read from the document — check it matches the request you mean.";
  }

  let reference = null;
  const canvass = source.match(/\bcanvass\s*(?:no\.?|number)?\s*[:\-#]?\s*([A-Z0-9][\w-]{3,})/i);
  const bac = source.match(/\bbac\s*resolution\s*(?:no\.?|number)?\s*[:\-#]?\s*([A-Z0-9][\w-]{3,})/i);
  if (bac) reference = "BAC Resolution " + bac[1];
  else if (canvass) reference = "Canvass " + canvass[1];

  /* ---- people / places ---- */
  let supplier = null;
  let supplierFlag = null;
  const supplierHit = labelValue(source, "supplier|vendor|bidder|awardee|contractor", {
    looseDelimiter: true, // purchase orders print "Supplier FJ-JD Trading" with no colon
  });
  if (supplierHit) {
    // A PO prints the supplier and the PO number on the same line, so stop
    // before the next label instead of swallowing it.
    const cut = supplierHit.value.split(/\b(?:po\s*no\.?|pono|tin|address|date|mode|contact)\b/i)[0].trim();
    supplier = cut.replace(/[.,;:]+$/, "").trim();
    if (supplier !== supplierHit.value.replace(/[.,;:]+$/, "").trim()) {
      supplierFlag = "Other details shared this line, so the name may be cut short or misread. Please check.";
    }
  }
  if (!supplier && kind === "award") {
    const awardee = source.match(
      /^\s*([A-Z0-9][A-Z0-9&.,'’\- ]{3,45}(?:TRADING|ENTERPRISES?|INC\.?|CORP\.?|SUPPLY|SUPPLIES|ENTERPRISE|CO\.?))\s+Date\s*:/im
    );
    if (awardee) {
      supplier = awardee[1].replace(/\s+/g, " ").trim();
      supplierFlag = "Taken from the addressee line of the award — please check the spelling.";
    }
  }
  if (supplier && supplierFlag) flags.supplier = supplierFlag;

  const requesterHit = labelValue(source, "requested\\s*by|requester|requested\\s*for");
  const requester = requesterHit ? requesterHit.value : null;

  // Require a real delimiter and a department-shaped label: "Department of
  // Health" on a letterhead is not a department field, and used to yield the
  // nonsense value "of Health".
  const deptHit = labelValue(source, "department|dept\\.");
  const department = deptHit ? deptHit.value : null;

  /* ---- dates ---- */
  let dueDate = null;
  const dueHit =
    source.match(/\bdue\s*date\s*[:\-]?\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})/i) ||
    source.match(/\bdelivery\s*(?:date|term)\s*[:\-]\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})/i) ||
    source.match(/\bdue\s*[:\-]\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})/i);
  if (dueHit) dueDate = normaliseDate(dueHit[1]);

  const documentDate = findDocumentDate(source);

  /* ---- kind-specific guidance ---- */
  if (kind === "award") {
    notices.push(
      "This looks like a Notice of Award. The fields below describe what was awarded, not a new request — check them before saving."
    );
  } else if (kind === "order") {
    notices.push("This looks like a Purchase Order. Saving creates a request for the same items — link it to the original PR if there is one.");
  } else if (kind === "other") {
    flags.kind = "Document type not recognised. Check the details carefully.";
    notices.push("This document type is not one the scanner knows about, so little was filled in automatically.");
  }

  return {
    kind,
    kindLabel: KIND_LABELS[kind] || KIND_LABELS.other,
    requestNumber,
    supplier,
    requester,
    department,
    item,
    quantity,
    estimatedAmount,
    dueDate,
    documentDate,
    reference,
    // Diagnostics: what was found, and how the total was corroborated.
    _rows: rows,
    _total: total,
    _amountCheck: { ok: estimatedAmount !== null, reason: amountReason },
    flags,
    notices,
  };
}

function decodeImage(input) {
  if (typeof input !== "string" || !input) return null;
  const match = input.match(/^data:image\/(png|jpe?g|webp|bmp);base64,(.+)$/i);
  if (!match) return null;
  return Buffer.from(match[2], "base64");
}

/** Thrown for input we can reject without touching the OCR engine. */
class UnsupportedImageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedImageError";
    this.status = 400;
  }
}

async function recognizeBuffer(buffer) {
  const type = detectImageType(buffer);
  if (!type) {
    throw new UnsupportedImageError(
      "That file is not a readable image. Re-photograph the document or choose a JPEG or PNG."
    );
  }

  let timer = null;
  try {
    const worker = await getWorker();

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("OCR timed out")), OCR_TIMEOUT_MS);
    });

    const { data } = await Promise.race([worker.recognize(buffer), timeout]);
    const text = String(data.text || "").trim();
    return {
      text,
      confidence: Math.round(Number(data.confidence) || 0),
      format: type,
      fields: extractFields(text),
    };
  } catch (err) {
    // The engine failed on this file: drop the worker so the next scan is not
    // affected, and let the caller decide what to tell the user.
    await resetWorker().catch(() => {});
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  recognizeBuffer,
  decodeImage,
  extractFields,
  detectKind,
  isReady,
  shutdown,
  detectImageType,
  UnsupportedImageError,
  // exported for the offline checker
  parseRow,
  findRows,
  findTotal,
  reconcile,
  KIND_LABELS,
};