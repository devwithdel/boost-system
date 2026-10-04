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

  console.log(`Seeded client account: ${email}`);
  console.log("Seeded dashboard demo data.");
  await pool.end();
}

async function seedDashboardData(userId) {
  const requests = [
    ["REQ-2026-001", "Operations", "Dell Latitude 5440 laptops for the new operations team", 6, 6900, "pending", "2026-09-18"],
    ["REQ-2026-002", "Facilities", "Ergonomic chairs for the second-floor workspace", 18, 5400, "pending", "2026-09-16"],
    ["REQ-2026-003", "Marketing", "Printed campaign collateral and display materials", 1, 2750, "pending", "2026-09-14"],
    ["REQ-2026-004", "IT", "Network switches and rack accessories", 4, 3200, "pending", "2026-09-10"],
  ];

  for (const [number, department, description, quantity, amount, status, dueDate] of requests) {
    await pool.query(
      `INSERT INTO procurement_requests
        (request_number, requester_name, department, item_description, quantity, estimated_amount, status, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (request_number)
       DO UPDATE SET
         requester_name = EXCLUDED.requester_name,
         department = EXCLUDED.department,
         item_description = EXCLUDED.item_description,
         quantity = EXCLUDED.quantity,
         estimated_amount = EXCLUDED.estimated_amount,
         status = EXCLUDED.status,
         due_date = EXCLUDED.due_date,
         created_by = EXCLUDED.created_by,
         updated_at = NOW()`,
      [number, "BOOST Team", department, description, quantity, amount, status, dueDate, userId]
    );
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

    if (!requestNumber) {
      await pool.query(
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
           updated_at = NOW()`,
        [number, supplier, description, amount, status, validUntil, createdAt]
      );
      continue;
    }

    await pool.query(
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
         updated_at = NOW()`,
      [number, supplier, description, amount, status, validUntil, createdAt, requestNumber]
    );
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

    await pool.query(
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
         updated_at = NOW()`,
      [number, supplier, amount, status, orderedAt, expectedDelivery, quotationNumber]
    );
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
    await pool.query(
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
         created_at = NOW()`,
      [number, title, type, fileName, fileSize, userId, new Date(Date.now() - daysAgo * 86400000)]
    );
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
