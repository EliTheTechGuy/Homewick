"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

/** Move a quote request along. New, quoted, then won or lost. */
export async function setEnquiryStatus(
  id: unknown,
  status: unknown,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, message: "Not signed in." };

  const parsedId = z.string().uuid().safeParse(id);
  const parsedStatus = z.enum(["new", "quoted", "won", "lost"]).safeParse(status);
  if (!parsedId.success || !parsedStatus.success) {
    return { ok: false, message: "Unknown request." };
  }

  await query(
    `update enquiries set status = $2, updated_at = now() where id = $1`,
    [parsedId.data, parsedStatus.data],
  );
  revalidatePath("/admin/enquiries");
  return { ok: true, message: "Updated." };
}
