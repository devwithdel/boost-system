/**
 * Creates (or updates) a local test CLIENT account and dashboard demo records,
 * using credentials from .env (SEED_EMAIL / SEED_PASSWORD / SEED_FULL_NAME).
 *
 * Usage:
 *   npm run seed
 *
 * This is for local development only — do not run against production with
 * placeholder credentials.
 */
require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("../db");

/**
 * Writes the one 'created' event every record should have, at the moment the
 * record itself was dated.
 *
 * Seeded rows used to be inserted straight into the tables, so they carried no
 * history at all: the notification bell stayed empty and every record's
 * history panel said "No activity recorded yet" until something was changed
 * through the UI. The trail is what the bell and the per-record timeline read,
 * so the demo data has to look like it was created the way real records are.
 *
 * Guarded on (entity, action) so re-running the seed does not stack duplicate
 * 'created' rows on top of the existing ones.
 */
/**
 * Records the status move that put a seeded record where it is today, so a
 * record sitting in 'awarded' or 'delivered' has the approval behind it rather
 * than appearing from nowhere. Guarded the same way as logCreated.
 */
async function logStatusChange({ entity, entityId, ref, from, to, actorId, actorName, at, note }) {
  await pool.query(
    `INSERT INTO activity_log
      (entity_type, entity_id, entity_ref, action, from_status, to_status, actor_id, actor_name, note, created_at)
     SELECT $1::varchar(30), $2::int, $3::varchar(80), 'status_change',
            $4::varchar(30), $5::varchar(30), $6::int, $7::text, $8::text, $9::timestamptz
     WHERE NOT EXISTS (
       SELECT 1 FROM activity_log
       WHERE entity_type = $1 AND entity_id = $2 AND action = 'status_change'
         AND from_status IS NOT DISTINCT FROM $4 AND to_status = $5
     )`,
    [entity, entityId, ref || null, from || null, to || null, actorId || null, actorName || null, note || null, at]
  );
}

async function logCreated({ entity, entityId, ref, status, actorId, actorName, at, note }) {
  await pool.query(
    // Every parameter is cast explicitly: a bare $1 in the select list defaults
    // to text while the comparison against the varchar column wants character
    // varying, which Postgres rejects as inconsistent deductions.
    `INSERT INTO activity_log
      (entity_type, entity_id, entity_ref, action, from_status, to_status, actor_id, actor_name, note, created_at)
     SELECT $1::varchar(30), $2::int, $3::varchar(80), 'created', NULL, $4::varchar(30),
            $5::int, $6::text, $7::text, $8::timestamptz
     WHERE NOT EXISTS (
       SELECT 1 FROM activity_log
       WHERE entity_type = $1 AND entity_id = $2 AND action = 'created'
     )`,
    [entity, entityId, ref || null, status || null, actorId || null, actorName || null, note || null, at]
  );
}

async function seed() {
  const email = (process.env.SEED_EMAIL || "").trim().toLowerCase();
  const password = process.env.SEED_PASSWORD;
  const fullName = process.env.SEED_FULL_NAME || "Test Client";

  if (!email || !password) {
    console.error("SEED_EMAIL and SEED_PASSWORD must be set in .env before seeding.");
    process.exit(1);
  }

  if (password === "change_me_before_seeding") {
    console.error("Refusing to seed with the placeholder password. Set SEED_PASSWORD in .env first.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { rows: userRows } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, 'client')
     ON CONFLICT (email)
     DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       updated_at = NOW()
     RETURNING id`,
    [fullName, email, passwordHash]
  );
  const userId = userRows[0].id;

  await seedDashboardData(userId);
  await seedBids(userId);

  const { rows: activityRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM activity_log`);
  console.log(`Seeded client account: ${email}`);
  console.log(`Seeded dashboard demo data (${activityRows[0].n} activity trail entries).`);
  await pool.end();
}

async function seedDashboardData(userId) {
  const requests = [
    ["REQ-2026-001", "Operations", "Dell Latitude 5440 laptops for the new operations team", 6, 6900, "completed", "2026-09-18"],
    ["REQ-2026-002", "Facilities", "Ergonomic chairs for the second-floor workspace", 18, 5400, "in_progress", "2026-09-16"],
    ["REQ-2026-003", "Marketing", "Printed campaign collateral and display materials", 1, 2750, "approved", "2026-09-14"],
    ["REQ-2026-004", "IT", "Network switches and rack accessories", 4, 3200, "approved", "2026-09-10"],
    // Left pending on purpose so the dashboard's approval queue is never empty.
    ["REQ-2026-005", "People Ops", "Annual health check for the field team", 24, 38400, "pending", "2026-11-30"],
  ];

  // How long ago each request was raised. The approval events land a day apart,
  // so this spread is what gives the cycle-time report something to measure.
  const REQUEST_AGE = {
    "REQ-2026-001": 118,
    "REQ-2026-002": 104,
    "REQ-2026-003": 62,
    "REQ-2026-004": 26,
    "REQ-2026-005": 3,
  };

  for (const [number, department, description, quantity, amount, status, dueDate] of requests) {
    // Requests are dated backwards rather than all landing "now", so the
    // cycle-time report measures a real spread instead of a single instant.
    const raisedDaysAgo = REQUEST_AGE[number] ?? 14;
    const requestedAt = new Date(Date.now() - raisedDaysAgo * 86400000);

    const { rows } = await pool.query(
      `INSERT INTO procurement_requests
        (request_number, requester_name, department, item_description, quantity, estimated_amount, status, due_date, requested_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (request_number)
       DO UPDATE SET
         requester_name = EXCLUDED.requester_name,
         department = EXCLUDED.department,
         item_description = EXCLUDED.item_description,
         quantity = EXCLUDED.quantity,
         estimated_amount = EXCLUDED.estimated_amount,
         status = EXCLUDED.status,
         due_date = EXCLUDED.due_date,
         requested_at = EXCLUDED.requested_at,
         created_by = EXCLUDED.created_by,
         updated_at = NOW()
       RETURNING id, requested_at`,
      [number, "BOOST Team", department, description, quantity, amount, status, dueDate, requestedAt, userId]
    );

    const raised = rows[0].requested_at;
    const day = 86400000;

    await logCreated({
      entity: "request",
      entityId: rows[0].id,
      ref: number,
      status: "pending",
      actorId: userId,
      actorName: "BOOST Team",
      at: raised,
    });

    // Walk the workflow one step per day so the trail has real gaps between
    // events — the cycle-time report reads those gaps, and identical
    // timestamps would report every request as approved in zero hours.
    const path = ["pending", "approved", "in_progress", "completed"];
    const reached = path.indexOf(status);
    if (reached > 0) {
      const steps = path.slice(1, reached + 1);
      for (let i = 0; i < steps.length; i++) {
        await logStatusChange({
          entity: "request",
          entityId: rows[0].id,
          ref: number,
          from: path[i],
          to: steps[i],
          actorId: userId,
          actorName: "BOOST Team",
          at: new Date(new Date(raised).getTime() + day * (i + 1)),
        });
      }
    }
  }

  // daysAgo spreads quotation activity across the last ~5 months so the
  // dashboard "Bids Submitted vs. Won — Monthly" chart has a real series.
  const quotations = [
    ["QUO-2026-011", null, "Laptop docking stations for the operations team", "TechSource Solutions", 2400, "awarded", 168],
    ["QUO-2026-012", null, "Office refresh furniture package", "Workwell Interiors", 8900, "awarded", 152],
    ["QUO-2026-013", null, "Monthly cleaning supplies", "Everclean Facilities", 1250, "awarded", 138],
    ["QUO-2026-018", null, "Server rack and cabling upgrade", "Northstar IT Supply", 15400, "awarded", 96],
    ["QUO-2026-019", null, "Annual software licence renewal", "CoreStack Systems", 42000, "awarded", 61],
    ["QUO-2026-020", null, "Pallet wrap and packaging supplies", "Everclean Facilities", 980, "awarded", 24],
    ["QUO-2026-014", "REQ-2026-001", "Dell Latitude 5440 laptops for the new operations team", "TechSource Solutions", 6900, "active", 7],
    ["QUO-2026-015", "REQ-2026-002", "Ergonomic chairs for the second-floor workspace", "Workwell Interiors", 5400, "active", 4],
    ["QUO-2026-016", "REQ-2026-003", "Printed campaign collateral and display materials", "Brightline Print Co.", 2750, "active", 2],
    ["QUO-2026-017", "REQ-2026-004", "Network switches and rack accessories", "Northstar IT Supply", 3200, "active", 1],
  ];

  for (const [number, requestNumber, description, supplier, amount, status, daysAgo] of quotations) {
    const createdAt = new Date(Date.now() - daysAgo * 86400000);
    const validUntil = new Date(Date.now() + daysAgo * 86400000);

    const { rows } = requestNumber
      ? await pool.query(
          `INSERT INTO quotations
            (quotation_number, request_id, supplier_name, item_description, total_amount, status, valid_until, created_at)
           SELECT $1, r.id, $2, $3, $4, $5, $6, $7
           FROM procurement_requests r
           WHERE r.request_number = $8
           ON CONFLICT (quotation_number)
           DO UPDATE SET
             supplier_name = EXCLUDED.supplier_name,
             item_description = EXCLUDED.item_description,
             total_amount = EXCLUDED.total_amount,
             status = EXCLUDED.status,
             valid_until = EXCLUDED.valid_until,
             created_at = EXCLUDED.created_at,
             updated_at = NOW()
           RETURNING id`,
          [number, supplier, description, amount, status, validUntil, createdAt, requestNumber]
        )
      : await pool.query(
          `INSERT INTO quotations
            (quotation_number, supplier_name, item_description, total_amount, status, valid_until, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (quotation_number)
           DO UPDATE SET
             supplier_name = EXCLUDED.supplier_name,
             item_description = EXCLUDED.item_description,
             total_amount = EXCLUDED.total_amount,
             status = EXCLUDED.status,
             valid_until = EXCLUDED.valid_until,
             created_at = EXCLUDED.created_at,
             updated_at = NOW()
           RETURNING id`,
          [number, supplier, description, amount, status, validUntil, createdAt]
        );

    // A quotation is raised as a draft and then made active for suppliers to
    // see, which is the state most of the seeded ones sit in.
    await logCreated({
      entity: "quotation",
      entityId: rows[0].id,
      ref: number,
      status: "draft",
      actorId: userId,
      actorName: "BOOST Team",
      at: createdAt,
    });

    if (status !== "draft") {
      await logStatusChange({
        entity: "quotation",
        entityId: rows[0].id,
        ref: number,
        from: "draft",
        to: status,
        actorId: userId,
        actorName: "BOOST Team",
        at: createdAt,
      });
    }
  }

  const orders = [
    ["PO-2026-031", "QUO-2026-012", "Workwell Interiors", 8900, "shipped", 3, 150],
    ["PO-2026-032", "QUO-2026-013", "Everclean Facilities", 1250, "approved", 6, 128],
    ["PO-2026-033", "QUO-2026-011", "TechSource Solutions", 2400, "pending", 8, 155],
    ["PO-2026-034", "QUO-2026-018", "Northstar IT Supply", 15400, "delivered", -10, 88],
    ["PO-2026-035", "QUO-2026-019", "CoreStack Systems", 42000, "delivered", -20, 52],
    ["PO-2026-036", "QUO-2026-020", "Everclean Facilities", 980, "approved", -3, 1],
  ];

  for (const [number, quotationNumber, supplier, amount, status, inDays, orderedDaysAgo] of orders) {
    const expectedDelivery = new Date(Date.now() + inDays * 86400000);
    const orderedAt = new Date(Date.now() - orderedDaysAgo * 86400000);

    const { rows } = await pool.query(
      `INSERT INTO purchase_orders
        (order_number, quotation_id, supplier_name, total_amount, status, ordered_at, expected_delivery_date)
       SELECT $1, q.id, $2, $3, $4, $5, $6
       FROM quotations q
       WHERE q.quotation_number = $7
       ON CONFLICT (order_number)
       DO UPDATE SET
         supplier_name = EXCLUDED.supplier_name,
         total_amount = EXCLUDED.total_amount,
         status = EXCLUDED.status,
         ordered_at = EXCLUDED.ordered_at,
         expected_delivery_date = EXCLUDED.expected_delivery_date,
         updated_at = NOW()
       RETURNING id`,
      [number, supplier, amount, status, orderedAt, expectedDelivery, quotationNumber]
    );

    // Orders are raised pending and then approved before anything is shipped.
    await logCreated({
      entity: "order",
      entityId: rows[0].id,
      ref: number,
      status: "pending",
      actorId: userId,
      actorName: "BOOST Team",
      at: orderedAt,
    });

    if (status !== "pending") {
      await logStatusChange({
        entity: "order",
        entityId: rows[0].id,
        ref: number,
        from: "pending",
        to: status,
        actorId: userId,
        actorName: "BOOST Team",
        at: orderedAt,
      });
    }
  }

  // daysAgo keeps demo uploads inside the current month so the
  // "Documents this month" summary count matches the recent list.
  const documents = [
    ["DOC-2026-041", "Laptop request approval form", "request", "REQ-2026-001-approval.pdf", 248000, 1],
    ["DOC-2026-042", "TechSource quotation comparison", "quotation", "QUO-2026-014-comparison.xlsx", 182000, 2],
    ["DOC-2026-043", "Office furniture purchase order", "order", "PO-2026-031.pdf", 156000, 4],
    ["DOC-2026-044", "Vendor onboarding checklist", "contract", "vendor-onboarding-checklist.pdf", 92000, 7],
  ];

  for (const [number, title, type, fileName, fileSize, daysAgo] of documents) {
    const uploadedAt = new Date(Date.now() - daysAgo * 86400000);

    const { rows } = await pool.query(
      `INSERT INTO documents
        (document_number, title, document_type, file_name, file_size_bytes, uploaded_by, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (document_number)
       DO UPDATE SET
         title = EXCLUDED.title,
         document_type = EXCLUDED.document_type,
         file_name = EXCLUDED.file_name,
         file_size_bytes = EXCLUDED.file_size_bytes,
         uploaded_by = EXCLUDED.uploaded_by,
         uploaded_at = EXCLUDED.uploaded_at,
         created_at = NOW()
       RETURNING id`,
      [number, title, type, fileName, fileSize, userId, uploadedAt]
    );

    await logCreated({
      entity: "document",
      entityId: rows[0].id,
      ref: number,
      status: null,
      actorId: userId,
      actorName: "BOOST Team",
      at: uploadedAt,
      note: title,
    });
  }
}

/* Demo bid packages for Bidding Records, and the reports read from them.
   Each package hangs off a seeded request so an award can be compared against
   that request's estimate — that comparison is the point of the reports.

   [number, requestNumber, title, status, openedDaysAgo, closedDaysAgo, offers]
   where each offer is [supplier, amount, outcome] and outcome is one of
   awarded | rejected | withdrawn | submitted. */
const BIDS = [
  ["BID-2026-101", "REQ-2026-001", "Laptop supply for the operations team", "awarded", 96, 88, [
    ["TechSource Solutions", 6450, "awarded"],
    ["Northstar IT Supply", 6720, "rejected"],
    ["CoreStack Systems", 6980, "rejected"],
  ]],
  ["BID-2026-102", "REQ-2026-002", "Ergonomic chairs, second-floor workspace", "awarded", 88, 74, [
    ["Workwell Interiors", 4980, "awarded"],
    ["Everclean Facilities", 5210, "rejected"],
    ["Brightline Print Co.", 5500, "withdrawn"],
  ]],
  ["BID-2026-103", "REQ-2026-003", "Campaign collateral and display materials", "awarded", 40, 31, [
    ["Brightline Print Co.", 2620, "awarded"],
    ["Workwell Interiors", 2890, "rejected"],
  ]],
  // Still open: offers are still coming in.
  ["BID-2026-104", "REQ-2026-004", "Network switches and rack accessories", "open", 12, null, [
    ["Northstar IT Supply", 3080, "submitted"],
    ["TechSource Solutions", 2950, "submitted"],
    ["CoreStack Systems", 3340, "submitted"],
  ]],
  // Closed with no award: every offer came in over budget.
  ["BID-2026-105", null, "Archive storage refresh", "closed", 20, 6, [
    ["CoreStack Systems", 18600, "submitted"],
    ["Northstar IT Supply", 21400, "submitted"],
  ]],
];

async function seedBids(userId) {
  for (const [number, requestNumber, title, status, openedDaysAgo, closedDaysAgo, offers] of BIDS) {
    const openedAt = new Date(Date.now() - openedDaysAgo * 86400000);
    const closedAt = closedDaysAgo === null ? null : new Date(Date.now() - closedDaysAgo * 86400000);

    let requestId = null;
    if (requestNumber) {
      const found = await pool.query(`SELECT id FROM procurement_requests WHERE request_number = $1`, [requestNumber]);
      requestId = found.rows[0]?.id || null;
    }

    const { rows } = await pool.query(
      `INSERT INTO bids (bid_number, request_id, title, status, opened_at, closed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (bid_number)
       DO UPDATE SET
         request_id = EXCLUDED.request_id,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         opened_at = EXCLUDED.opened_at,
         closed_at = EXCLUDED.closed_at,
         updated_at = NOW()
       RETURNING id`,
      [number, requestId, title, status, openedAt, closedAt, userId]
    );
    const bidId = rows[0].id;

    await logCreated({
      entity: "bid",
      entityId: bidId,
      ref: number,
      status: "draft",
      actorId: userId,
      actorName: "BOOST Team",
      at: openedAt,
      note: title,
    });

    await logStatusChange({
      entity: "bid",
      entityId: bidId,
      ref: number,
      from: "draft",
      to: "open",
      actorId: userId,
      actorName: "BOOST Team",
      at: openedAt,
    });

    // Offers arrive after the package opens and before it closes, spaced evenly
    // so the trail reads in a believable order.
    const span = (closedAt ? closedAt.getTime() - openedAt.getTime() : 10 * 86400000) / (offers.length + 1);

    for (let i = 0; i < offers.length; i++) {
      const [supplier, amount, outcome] = offers[i];
      const at = new Date(openedAt.getTime() + span * (i + 1));

      // Idempotent: leave an existing offer exactly as the app left it.
      const existing = await pool.query(
        `SELECT id FROM bid_submissions WHERE bid_id = $1 AND supplier_name = $2`,
        [bidId, supplier]
      );
      if (existing.rows.length) continue;

      await pool.query(
        `INSERT INTO bid_submissions (bid_id, supplier_name, total_amount, status, submitted_at, awarded_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bidId, supplier, amount, outcome, at, outcome === "awarded" ? closedAt : null]
      );

      await pool.query(
        `INSERT INTO activity_log
          (entity_type, entity_id, entity_ref, action, actor_id, actor_name, note, created_at)
         VALUES ('bid', $1, $2, 'submission_received', $3, 'BOOST Team', $4, $5)`,
        [bidId, number, userId, `${supplier} bid ${amount}`, at]
      );

      if (outcome === "awarded") {
        await pool.query(
          `INSERT INTO activity_log
            (entity_type, entity_id, entity_ref, action, from_status, to_status, actor_id, actor_name, created_at)
           VALUES ('bid', $1, $2, 'awarded', 'submitted', 'awarded', $3, 'BOOST Team', $4)`,
          [bidId, number, userId, closedAt]
        );
      } else if (outcome === "rejected" || outcome === "withdrawn") {
        await pool.query(
          `INSERT INTO activity_log
            (entity_type, entity_id, entity_ref, action, from_status, to_status, actor_id, actor_name, note, created_at)
           VALUES ('bid', $1, $2, 'status_change', 'submitted', $3, $4, 'BOOST Team', $5, $6)`,
          [bidId, number, outcome, userId, supplier, closedAt || at]
        );
      }
    }

    if (status === "closed" || status === "awarded") {
      await logStatusChange({
        entity: "bid",
        entityId: bidId,
        ref: number,
        from: "open",
        to: status,
        actorId: userId,
        actorName: "BOOST Team",
        at: closedAt,
      });
    }
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
