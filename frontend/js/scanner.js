/* BOOST — Scan a Document: capture a document photo, read it with the
   server-side OCR engine, review the extracted fields, save as a request. */
(function () {
  "use strict";

  var state = { image: null, fileName: "", result: null, busy: false };

  var fileInput, cameraInput, preview, shotBox, actionsBox, fieldsBox, textBox, statusBox;

  function toDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("Could not read that file.")); };
      reader.readAsDataURL(file);
    });
  }

  function setStatus(text, tone) {
    statusBox.textContent = text || "";
    statusBox.className = "scan-status" + (tone ? " " + tone : "");
    statusBox.hidden = !text;
  }

  /* Phase 6: validate as you type instead of waiting for a server round-trip. */
  function validateField(id) {
    var el = document.getElementById("f-" + id);
    if (!el) return true;

    var wrap = el.closest(".field");
    var err = wrap ? wrap.querySelector(".field-error") : null;
    var value = el.value.trim();
    var message = "";

    if (id === "item" && !value) message = "Describe what is being requested.";
    if (id === "quantity") {
      var qty = Number(value);
      if (!value) message = "Enter a quantity.";
      else if (!isFinite(qty) || qty <= 0) message = "Quantity must be greater than zero.";
      else if (!Number.isInteger(qty)) message = "Use a whole number.";
    }
    if (id === "estimatedAmount") {
      var amt = Number(value);
      if (!value) message = "Enter an estimated amount.";
      else if (!isFinite(amt) || amt < 0) message = "Amount cannot be negative.";
    }
    if (id === "dueDate" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      message = "Use the date picker or YYYY-MM-DD.";
    }

    if (wrap) wrap.classList.toggle("invalid", !!message);
    el.setAttribute("aria-invalid", message ? "true" : "false");
    if (err) err.textContent = message;
    return !message;
  }

  function validateAll() {
    return ["item", "quantity", "estimatedAmount", "dueDate"].map(validateField).every(Boolean);
  }

  function fieldsToState() {
    var get = function (id) {
      var el = document.getElementById("f-" + id);
      return el ? el.value.trim() : "";
    };
    return {
      requestNumber: get("requestNumber"),
      requester: get("requester"),
      department: get("department"),
      item: get("item"),
      quantity: get("quantity"),
      estimatedAmount: get("estimatedAmount"),
      dueDate: get("dueDate"),
    };
  }

  function renderNotices(notices) {
    var box = document.getElementById("notices");
    if (!box) return;

    var list = (notices || []).filter(Boolean);
    if (!list.length) {
      box.innerHTML = "";
      return;
    }

    // The first line explains what kind of document this is; anything after
    // it is a specific problem worth reading before saving.
    box.innerHTML = list
      .map(function (text, i) {
        var tone = i === 0 ? "scan-notice info" : "scan-notice";
        return (
          '<p class="' + tone + '">' +
          BOOST.icon(i === 0 ? "info" : "alert", { size: 15 }) +
          "<span>" + BOOST.esc(text) + "</span></p>"
        );
      })
      .join("");
  }

  function renderFields(fields, flags) {
    var warn = flags || {};
    var rows = [
      ["kind", "Document type"],
      ["requestNumber", "Request number"],
      ["requester", "Requester"],
      ["department", "Department"],
      ["item", "Item / description"],
      ["quantity", "Quantity", "number", { min: "1", step: "1" }],
      ["estimatedAmount", "Estimated amount (₱)", "number", { min: "0", step: "0.01" }],
      ["dueDate", "Due date", "date"],
      // Read-only context the scanner found, so the reviewer can see what the
      // page actually said instead of only the fields we can map to a request.
      ["supplier", "Supplier / awardee"],
      ["reference", "Reference"],
      ["documentDate", "Document date"],
    ];

    fieldsBox.innerHTML = rows
      .map(function (row) {
        var key = row[0];
        var type = row[2] || "text";
        var attrs = row[3] || {};

        var raw = fields[key];
        var value = raw === null || raw === undefined ? "" : String(raw);
        if (key === "kind") value = fields.kindLabel || value;
        if (key === "dueDate" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) value = "";

        // Anything the scanner could not map to a request is shown but never
        // submitted.
        var readOnly = key === "kind" || key === "supplier" || key === "reference" || key === "documentDate";
        if (readOnly) attrs = Object.assign({}, attrs, { readonly: "readonly" });

        var attrHtml = Object.keys(attrs)
          .map(function (a) { return a + '="' + BOOST.esc(attrs[a]) + '"'; })
          .join(" ");

        var flag = warn[key];

        return (
          '<label class="field' + (flag ? " flagged" : "") + '"><span>' +
          BOOST.esc(row[1]) + (readOnly ? " <em class=\"ro-tag\">read only</em>" : "") + "</span>" +
          '<input id="f-' + key + '" type="' + type + '" value="' + BOOST.esc(value) + '" ' + attrHtml +
          (key === "kind" ? ' class="ro"' : "") +
          ' aria-describedby="err-' + key + (flag ? " flag-" + key : "") + '" />' +
          '<p class="field-error" id="err-' + key + '" role="alert"></p>' +
          (flag
            ? '<p class="field-flag" id="flag-' + key + '">' +
              BOOST.icon("alert", { size: 13 }) +
              "<span>" + BOOST.esc(flag) + "</span></p>"
            : "") +
          "</label>"
        );
      })
      .join("");

    // Validate on blur, clear the error while typing is being fixed.
    Object.keys(fields).forEach(function (key) {
      var el = document.getElementById("f-" + key);
      if (!el) return;
      el.addEventListener("blur", function () { validateField(key); });
      el.addEventListener("input", function () {
        var wrap = el.closest(".field");
        if (wrap && wrap.classList.contains("invalid")) validateField(key);
        // Editing a flagged field counts as reviewing it: drop the warning so
        // the form reflects what is still outstanding, not what was scanned.
        if (wrap && wrap.classList.contains("flagged")) {
          wrap.classList.remove("flagged");
          var note = wrap.querySelector(".field-flag");
          if (note) note.remove();
        }
        markDirty();
      });
    });

    validateAll();
  }

  function showResult(result) {
    state.result = result;
    textBox.value = result.text || "";

    var fields = result.fields || {};
    var flags = fields.flags || {};
    renderNotices(fields.notices);
    renderFields(fields, flags);

    actionsBox.hidden = false;
    clearDirty();

    var flagCount = Object.keys(flags).length;
    var tone = result.confidence >= 70 ? "ok" : "warn";
    var summary = "Read " + (result.text || "").length + " characters · confidence " + result.confidence + "%";
    if (flagCount) summary += " · " + flagCount + " field" + (flagCount > 1 ? "s" : "") + " to check";
    setStatus(summary, flagCount ? "warn" : tone);
  }

  async function runOcr() {
    if (!state.image || state.busy) return;
    state.busy = true;
    setBusy(true);
    setStatus("Reading document… this can take a few seconds on first run.", "busy");

    try {
      var res = await fetch("/api/scanner/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ image: state.image }),
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || "OCR failed.");
      showResult(body);
    } catch (err) {
      setStatus(err.message, "warn");
    } finally {
      state.busy = false;
      setBusy(false);
    }
  }

  function setBusy(busy) {
    var btn = document.getElementById("run-ocr");
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? "Reading…" : "Read document";
  }

  async function saveRequest() {
    // Inline validation first: point at the offending field instead of a
    // generic toast.
    if (!validateAll()) {
      setStatus("Please correct the highlighted fields.", "warn");
      var firstBad = fieldsBox.querySelector(".field.invalid input");
      if (firstBad) firstBad.focus();
      return;
    }

    var values = fieldsToState();

    // An unrecognised document gets one extra confirmation: everything below
    // was read on a best-effort basis, so a stray scan should not quietly
    // become a request.
    var kind = state.result && state.result.fields ? state.result.fields.kind : null;
    if (kind === "other") {
      var ok = window.confirm(
        "BOOST could not recognise this document type, so the details below are a best guess.\n\n" +
          "Check them, then save as a request?"
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      var res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(values),
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not save the request.");

      document.getElementById("save-request").disabled = true;
      clearDirty();

      // This just created a request, so the sidebar count and the bell are
      // already out of date. The manual request form does the same.
      BOOST.refreshBadges();

      // The scan is evidence, not just a source of text — keep the photo.
      await attachScan(body.request.id, body.request.requestNumber);
    } catch (err) {
      setStatus(err.message, "warn");
    } finally {
      setBusy(false);
    }
  }

  function attachScan(requestId, requestNumber) {
    return fetch("/api/requests/" + requestId + "/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ image: state.image, fileName: state.fileName, source: "scan" }),
    })
      .then(function (r) {
        return r.json().then(function (b) {
          return { ok: r.ok, body: b };
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error(res.body.error || "Could not attach the scan.");
        setStatus("Saved as " + requestNumber + " with the scan attached · status pending.", "ok");
      })
      .catch(function (err) {
        // The request itself exists; only the photo failed. Say so plainly
        // instead of implying the save failed.
        setStatus(
          "Saved as " + requestNumber + ", but the scan could not be attached: " + err.message,
          "warn"
        );
      });
  }

  /* Phase 5: never lose reviewed OCR data by accident. */
  var dirty = false;

  function markDirty() {
    dirty = true;
    var note = document.getElementById("dirty-note");
    if (note) note.hidden = false;
  }

  function clearDirty() {
    dirty = false;
    var note = document.getElementById("dirty-note");
    if (note) note.hidden = true;
  }

  function guardUnsaved(e) {
    if (!dirty) return undefined;
    e.preventDefault();
    e.returnValue = "";
    return "";
  }

  function confirmDiscard() {
    return !dirty || window.confirm("Discard the details you have reviewed?");
  }

  function reset() {
    if (!confirmDiscard()) return;

    dirty = false;
    state = { image: null, fileName: "", result: null, busy: false };
    fileInput.value = "";
    if (cameraInput) cameraInput.value = "";
    preview.removeAttribute("src");
    shotBox.hidden = true;
    actionsBox.hidden = true;
    fieldsBox.innerHTML = "";
    var notices = document.getElementById("notices");
    if (notices) notices.innerHTML = "";
    textBox.value = "";
    var save = document.getElementById("save-request");
    if (save) save.disabled = false;
    setStatus("");
  }

  function accept(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      setStatus("That file is not an image. Choose a photo or screenshot.", "warn");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setStatus("Image is too large. Keep it under 8 MB.", "warn");
      return;
    }

    toDataUrl(file)
      .then(function (dataUrl) {
        state.image = dataUrl;
        state.fileName = file.name || "capture.jpg";
        preview.src = dataUrl;
        shotBox.hidden = false;
        setStatus("Ready to read " + state.fileName + ".", "ok");
      })
      .catch(function (err) {
        setStatus(err.message, "warn");
      });
  }

  function hasCamera() {
    // Explicit override so the mobile flow can be tested from any preview:
    //   /scanner?camera=1   force the camera button on
    //   /scanner?camera=0   force it off
    try {
      var forced = new URLSearchParams(window.location.search).get("camera");
      if (forced === "1" || forced === "true") return true;
      if (forced === "0" || forced === "false") return false;
    } catch (e) {
      /* URLSearchParams unavailable — fall through to detection */
    }

    // `capture` is only honoured on touch devices; a desktop browser ignores
    // it and opens the very same file picker. Offering both buttons there just
    // looks like a duplicate, so the camera button is for phones and tablets.
    return (
      typeof window.matchMedia === "function" &&
      (window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
        navigator.maxTouchPoints > 0)
    );
  }

  function render() {
    var camera = hasCamera();

    document.getElementById("page").innerHTML =
      '<div class="stack">' +
      '<section class="card">' +
      '<div class="card-head"><div><h2>Scan a document</h2><p>Photograph a request, quotation or receipt and read it automatically</p></div></div>' +
      '<div class="card-body">' +
      '<div class="scan-actions">' +
      (camera
        ? '<label class="btn" for="camera-input">' + BOOST.icon("scanner", { size: 16 }) + " Take photo</label>" +
          '<input id="camera-input" type="file" accept="image/*" capture="environment" hidden />'
        : "") +
      '<label class="btn' + (camera ? " ghost" : "") + '" for="file-input">' +
      BOOST.icon("image", { size: 16 }) +
      (camera ? " Choose image" : " Choose image or photo") +
      "</label>" +
      '<input id="file-input" type="file" accept="image/*" hidden />' +
      '<button class="btn ghost" type="button" id="run-ocr" disabled>Read document</button>' +
      '<button class="btn ghost" type="button" id="reset">Clear</button>' +
      "</div>" +
      '<p class="scan-status" id="status" hidden></p>' +
      '<div class="scan-drop" id="drop">' +
      (camera ? "Choose an image, or take a photo of the document." : "Drop an image here, or choose one above.") +
      "</div>" +
      "</div>" +
      "</section>" +

      '<section class="card" id="shot-card" hidden>' +
      '<div class="card-head"><div><h2>Captured image</h2><p id="shot-name"></p></div></div>' +
      '<div class="card-body"><img id="preview" class="scan-preview" alt="Captured document" /></div>' +
      "</section>" +

      '<section class="card" id="result-card" hidden>' +
      '<div class="card-head"><div><h2>Review extracted details</h2><p>Correct anything the scanner missed, then save</p></div></div>' +
      '<div class="card-body">' +
      '<div class="scan-notices" id="notices"></div>' +
      '<div class="field-grid" id="fields"></div>' +
      '<label class="field" style="margin-top:14px"><span>Raw text</span>' +
      '<textarea id="raw-text" rows="6" readonly></textarea></label>' +
      "</div>" +
      '<div class="card-head" style="border-top:1px solid var(--line-soft);border-bottom:0">' +
      '<span class="muted-note">Saving creates a pending procurement request. ' +
      '<span class="dirty-note" id="dirty-note" hidden>● Unsaved changes</span></span>' +
      '<button class="btn" type="button" id="save-request">Save as request</button>' +
      "</div>" +
      "</section>" +
      "</div>";

    fileInput = document.getElementById("file-input");
    cameraInput = document.getElementById("camera-input");
    preview = document.getElementById("preview");
    shotBox = document.getElementById("shot-card");
    actionsBox = document.getElementById("result-card");
    fieldsBox = document.getElementById("fields");
    textBox = document.getElementById("raw-text");
    statusBox = document.getElementById("status");

    fileInput.addEventListener("change", function () {
      accept(fileInput.files[0]);
      document.getElementById("run-ocr").disabled = false;
    });
    if (cameraInput) {
      cameraInput.addEventListener("change", function () {
        accept(cameraInput.files[0]);
        document.getElementById("run-ocr").disabled = false;
      });
    }
    document.getElementById("run-ocr").addEventListener("click", runOcr);
    document.getElementById("save-request").addEventListener("click", saveRequest);
    document.getElementById("reset").addEventListener("click", reset);
    document.getElementById("run-ocr").disabled = true;

    window.addEventListener("beforeunload", guardUnsaved);

    // Leaving the module from the sidebar shouldn't silently drop work either.
    document.querySelectorAll("#sidebar .nav-item").forEach(function (link) {
      link.addEventListener("click", function (e) {
        if (!dirty) return;
        if (!window.confirm("You have unsaved scanned details. Leave anyway?")) {
          e.preventDefault();
          return;
        }
        clearDirty();
      });
    });

    var drop = document.getElementById("drop");
    ["dragenter", "dragover"].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.add("over");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.remove("over");
      });
    });
    drop.addEventListener("drop", function (e) {
      var file = e.dataTransfer.files[0];
      if (file) {
        accept(file);
        document.getElementById("run-ocr").disabled = false;
      }
    });

    BOOST.setBadges({ requests: null });
  }

  BOOST.mount(function () {
    render();
    return BOOST.json("/api/scanner/status").then(function (s) {
      if (!s.available) {
        setStatus("OCR engine is unavailable on this server.", "warn");
      }
    });
  });
})();