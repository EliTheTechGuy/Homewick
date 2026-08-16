"use server";

import { transaction } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { TIMEZONE } from "@/lib/dates";
import { visitTokenValid } from "@/lib/visit-links";

export type JobRevealResult =
  | {
      ok: true;
      gateCode: string | null;
      doorCode: string | null;
      keyLocation: string | null;
      alarmInstructions: string | null;
    }
  | { ok: false; error: string };

/**
 * Entry details for a cleaner holding a signed job link.
 *
 * Same two rules as the admin path, for the same reasons. The day-of window
 * means a leaked link is worthless on all but one day, and the audit row is
 * written inside the transaction before any plaintext is returned, so a
 * failure afterwards cannot produce an unlogged read.
 *
 * The actor recorded is the assigned cleaner, taken from the visit rather than
 * from anything the caller sends, so the log cannot be written under somebody
 * else's name.
 */
export async function revealJobAccess(
  visitId: string,
  token: string,
): Promise<JobRevealResult> {
  if (!visitTokenValid(visitId, token)) {
    return { ok: false, error: "This link is not valid." };
  }

  try {
    return await transaction(async (client) => {
      const { rows } = await client.query<{
        property_id: string;
        is_today: boolean;
        cleaner_name: string | null;
      }>(
        `select v.property_id,
                (v.scheduled_for at time zone $2)::date = (now() at time zone $2)::date
                  as is_today,
                cl.first_name || ' ' || cl.last_name as cleaner_name
           from visits v
           left join cleaners cl on cl.id = v.assigned_cleaner_id
          where v.id = $1 and v.status <> 'canceled'`,
        [visitId, TIMEZONE],
      );

      const visit = rows[0];
      if (!visit) return { ok: false as const, error: "That job is no longer on." };
      if (!visit.is_today) {
        return {
          ok: false as const,
          error: "Entry details unlock on the morning of the visit.",
        };
      }

      const { rows: secretRows } = await client.query<{
        gate_code_enc: Buffer | null;
        door_code_enc: Buffer | null;
        key_location_enc: Buffer | null;
        alarm_instructions_enc: Buffer | null;
      }>(
        `select gate_code_enc, door_code_enc, key_location_enc, alarm_instructions_enc
           from property_access_secrets where property_id = $1`,
        [visit.property_id],
      );

      const secrets = secretRows[0];
      if (!secrets) return { ok: false as const, error: "No entry details on file." };

      await client.query(
        `insert into access_reveals (property_id, actor, visit_id) values ($1, $2, $3)`,
        [visit.property_id, `cleaner:${visit.cleaner_name ?? "unassigned"}`, visitId],
      );

      return {
        ok: true as const,
        gateCode: decryptSecret(secrets.gate_code_enc),
        doorCode: decryptSecret(secrets.door_code_enc),
        keyLocation: decryptSecret(secrets.key_location_enc),
        alarmInstructions: decryptSecret(secrets.alarm_instructions_enc),
      };
    });
  } catch (err) {
    console.error("[job] access reveal failed", err);
    return { ok: false, error: "Could not read entry details." };
  }
}
