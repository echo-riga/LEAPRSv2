import { sql } from 'drizzle-orm';
import type { Transaction } from '@/db/transaction';

type Actor = { actorId: string; actorName: string; actorEmail: string | null };

// The caller checks permissions and locks the request and CapDev first.
// Deletion never changes the CapDev balance.
export async function deleteRequestRecords(tx: Transaction, id: number, actor: Actor) {
  return tx.execute(sql`
      WITH deleted_status_updates AS (
        DELETE FROM request_status_updates
        WHERE request_id = ${id}
        RETURNING id, subtracts_requested_amount
      ),
      deleted_request AS (
        DELETE FROM requests
        WHERE id = ${id}
          AND (SELECT COUNT(*) FROM deleted_status_updates) >= 0
        RETURNING id, capdev_id, setting, requestor_name, requested_budget
      ),
      inserted_audit AS (
        INSERT INTO audit_logs (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, details)
        SELECT ${actor.actorId}, ${actor.actorName}, ${actor.actorEmail}, 'deleted', 'request', deleted_request.id::text, COALESCE(NULLIF(deleted_request.requestor_name, ''), 'Requestor') || '''s request',
          jsonb_build_object(
            'capdevId', deleted_request.capdev_id,
            'capdevAipCode', capdev.aip_code,
            'setting', deleted_request.setting,
            'requestorName', deleted_request.requestor_name
          )
        FROM deleted_request
        INNER JOIN capdevs AS capdev ON capdev.id = deleted_request.capdev_id
        RETURNING id
      )
      SELECT id FROM inserted_audit
      `);
}
