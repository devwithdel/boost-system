const pool = require("../db");

/**
 * One audit trail for every module.
 *
 * Requests, quotations, purchase orders and documents all write here, so the
 * notification bell and each record's history read from a single place. Pass
 * the transaction client as `executor` when the event belongs to a change that
 * must roll back together with it.
 */

const ENTITY_TYPES = ["request", "quotation", "order", "document"];

function isEntityType(value) {
  return ENTITY_TYPES.indexOf(value) !== -1;
}

/**
 * Record one event.
 *
 * @param {object}  entry
 * @param {string}  entry.entity      request | quotation | order | document
 * @param {number}  entry.entityId
 * @param {string} [entry.ref]         human label shown in the trail
 * @param {string}  entry.action      created | status_change | bulk_status | …
 * @param {string} [entry.from]       previous status
 * @param {string} [entry.to]         new status
 * @param {object} [entry.actor]      { sub, fullName }
 * @param {string} [entry.note]
 * @param {object} [executor]         pg client or pool (defaults to the pool)
 */
async function record(entry, executor) {
  const run = executor || pool;
  if (!isEntityType(entry.entity)) {
    throw new Error(`Unknown entity type "${entry.entity}"`);
  }
  if (!Number.isInteger(Number(entry.entityId))) {
    throw new Error("entityId is required");
  }

  const actor = entry.actor || {};
  const result = await run.query(
    `INSERT INTO activity_log
       (entity_type, entity_id, entity_ref, action, from_status, to_status, actor_id, actor_name, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, created_at AS "createdAt"`,
    [
      entry.entity,
      Number(entry.entityId),
      entry.ref || null,
      entry.action,
      entry.from || null,
      entry.to || null,
      actor.sub || null,
      actor.fullName || null,
      entry.note || null,
    ]
  );
  return result.rows[0];
}

/** History for one record, newest first. */
async function forEntity(entity, entityId, limit = 50) {
  if (!isEntityType(entity)) return [];
  const result = await pool.query(
    `SELECT id, action, from_status AS "fromStatus", to_status AS "toStatus",
            actor_name AS "actorName", note, created_at AS "createdAt"
     FROM activity_log
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at DESC, id DESC
     LIMIT $3`,
    [entity, Number(entityId), Math.min(Number(limit) || 50, 200)]
  );
  return result.rows;
}

/** Most recent activity across every module, for the notification bell. */
async function recent(limit = 25) {
  const result = await pool.query(
    `SELECT id, entity_type AS "entityType", entity_id AS "entityId",
            entity_ref AS "entityRef", action,
            from_status AS "fromStatus", to_status AS "toStatus",
            actor_name AS "actorName", note, created_at AS "createdAt"
     FROM activity_log
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [Math.min(Number(limit) || 25, 100)]
  );
  return result.rows;
}

module.exports = { record, forEntity, recent, isEntityType, ENTITY_TYPES };