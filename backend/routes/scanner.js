const express = require("express");
const ocr = require("../services/ocr");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * GET /api/scanner/status
 * Tells the UI whether OCR is available on this server.
 */
router.get("/status", requireAuth, (req, res) => {
  return res.json({ available: ocr.isReady(), lang: process.env.OCR_LANG || "eng" });
});

/**
 * POST /api/scanner/ocr
 * Body: { image: "data:image/png;base64,..." }
 * Returns the recognised text plus best-effort structured fields.
 */
router.post("/ocr", requireAuth, async (req, res) => {
  const buffer = ocr.decodeImage(req.body?.image);

  if (!buffer) {
    return res.status(400).json({ error: "Send an image as a base64 data URL (png, jpeg, webp or bmp)." });
  }

  if (buffer.length > MAX_BYTES) {
    return res.status(413).json({ error: "Image is too large. Keep it under 8 MB." });
  }

  try {
    const result = await ocr.recognizeBuffer(buffer);
    return res.json(result);
  } catch (err) {
    // Corrupt or unreadable file: the user's problem, not a server fault.
    if (err && err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error("OCR error:", (err && err.message) || err);
    return res.status(500).json({ error: "Could not read that image. Try a clearer, straight-on photo." });
  }
});

module.exports = router;