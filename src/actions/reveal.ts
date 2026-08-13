"use server";

import { transaction } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { requireAdmin } from "@/lib/admin-auth";
import { TIMEZONE } from "@/lib/dates";

export type RevealResult =
  | {
      ok: true;
      gateCode: string | null;
      doorCode: string | null;
      keyLocation: string | null;
      alarmInstructions: string | null;
    }
  | { ok: false; error: string };

/**
 * Decrypts a property's entry details.
 *
 * Two rules hold here. Reads are restricted to the day of service — an entry
 * code is not general reference data, it is a key that is only needed when
 * someone is standing at the door. And every read is written to
 * access_reveals before the plaintext is returned, so there is an audit trail
 * even if the request then fails.
 */
export async function revealAccess(
  propertyId: string,
  visitId: string,
): Promise<RevealResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };

  try {
    return await transaction(async (client) => {
      const { rows: visitRows } = await client.query<{ is_today: boolean }>(
        `select (v.scheduled_for at time zone $3)::date = (now() at time zone $3)::date
                  as is_today
           from visits v
          where v.id = $1 and v.property_id = $2`,
        [visitId, propertyId, TIMEZONE],
      );

      const visit = visitRows[0];
      if (!visit) return { ok: false as const, error: "Visit not found." };
      if (!visit.is_today) {
        return {
          ok: false as const,
          error: "Entry details are only available on the day of service.",
        };
      }

      const { rows } = await client.query<{
        gate_code_enc: Buffer | null;
        door_code_enc: Buffer | null;
        key_location_enc: Buffer | null;
        alarm_instructions_enc: Buffer | null;
      }>(
        `select gate_code_enc, door_code_enc, key_location_enc, alarm_instructions_enc
           from property_access_secrets where property_id = $1`,
        [propertyId],
      );

      const secrets = rows[0];
      if (!secrets) return { ok: false as const, error: "No entry details on file." };

      // Logged before the plaintext leaves this function.
      await client.query(
        `insert into access_reveals (property_id, actor, visit_id) values ($1, $2, $3)`,
        [propertyId, admin.actor, visitId],
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
    console.error("Access reveal failed", err);
    return { ok: false, error: "Could not read entry details." };
  }
}
