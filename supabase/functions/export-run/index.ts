// ============================================================================
// export-run — CSV generation for selected leads / searches / lists.
// States: preparing → processing → completed | failed.
// ============================================================================
import {
  HttpError,
  callerFromRequest,
  corsHeaders,
  errorJson,
  handleError,
  json,
  logActivity,
  requireWorkspaceRole,
  serviceClient,
} from "../_shared/index.ts";

const CSV_COLUMNS = [
  "name",
  "category",
  "rating",
  "reviews",
  "price",
  "phone",
  "email",
  "website",
  "address",
  "city",
  "state",
  "postal_code",
  "country",
  "latitude",
  "longitude",
  "status",
  "tags",
  "source",
] as const;

/*
 * Spreadsheet formula injection — identical rule to api/export-run.ts
 * (the Vercel route). A cell that a spreadsheet would evaluate as a formula
 * is prefixed with an apostrophe so it stays literal text; plain numbers and
 * international phone numbers are left untouched.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const PHONE_LIKE = /^\+\d[\d\s().-]*$/;

function neutralizeCsvFormula(text: string): string {
  if (!FORMULA_LEAD.test(text)) return text;
  if (PLAIN_NUMBER.test(text) || PHONE_LIKE.test(text)) return text;
  return `'${text}`;
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const raw = Array.isArray(value) ? value.join("; ") : String(value);
  const text = neutralizeCsvFormula(raw);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  try {
    const sb = serviceClient();
    const body = await req.json().catch(() => ({}));
    const UUID = /^[0-9a-f-]{36}$/i;
    const workspaceId = String(body.workspaceId ?? "");
    const source = String(body.source ?? "Selection").slice(0, 120);
    /* Malformed ids are dropped rather than forwarded to PostgREST, which
       would answer with a database-level type error. */
    const leadIds: string[] = Array.isArray(body.leadIds)
      ? body.leadIds.map(String).filter((id: string) => UUID.test(id))
      : [];
    const searchId = body.searchId && UUID.test(String(body.searchId)) ? String(body.searchId) : null;
    const listId = body.listId && UUID.test(String(body.listId)) ? String(body.listId) : null;
    if (!UUID.test(workspaceId)) throw new HttpError(400, "A valid workspace is required.");
    if (!leadIds.length && !searchId && !listId) {
      throw new HttpError(400, "Choose leads, a list, or a search to export.");
    }
    if (leadIds.length > 50000) throw new HttpError(400, "Export is limited to 50,000 leads per file.");

    const user = await callerFromRequest(req, sb);
    await requireWorkspaceRole(sb, user.id, workspaceId);

    const fileName =
      String(body.fileName ?? "").trim() ||
      `${source.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "leads"}-${new Date().toISOString().slice(0, 10)}.csv`;

    /* prepare export row: preparing → processing */
    const { data: exportRow, error: insertErr } = await sb
      .from("exports")
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        file_name: fileName.endsWith(".csv") ? fileName : `${fileName}.csv`,
        source,
        status: "preparing",
      })
      .select()
      .single();
    if (insertErr) throw new HttpError(500, "Couldn't start the export.");

    await sb.from("exports").update({ status: "processing" }).eq("id", exportRow.id);

    // gather leads (workspace-scoped — member already verified)
    let leads: Record<string, unknown>[] = [];
    if (leadIds.length) {
      const { data, error } = await sb
        .from("leads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("id", leadIds)
        .order("name");
      if (error) throw new HttpError(500, "Couldn't read the leads for this export.");
      leads = data ?? [];
    } else if (searchId) {
      const { data: search } = await sb
        .from("lead_searches")
        .select("id")
        .eq("id", searchId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!search) {
        await sb.from("exports").update({ status: "failed", error: "search_not_found" }).eq("id", exportRow.id);
        throw new HttpError(404, "That search wasn't found in this workspace.");
      }
      const { data, error } = await sb
        .from("leads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("search_id", searchId)
        .order("name")
        .limit(50000);
      if (error) throw new HttpError(500, "Couldn't read the leads for this export.");
      leads = data ?? [];
    } else if (listId) {
      /* This function runs with the service key, so RLS is NOT the boundary
         here: the list itself must be proven to belong to the workspace the
         caller was authorized for. Without this check a member of workspace A
         could export any list id from workspace B. */
      const { data: list } = await sb
        .from("lead_lists")
        .select("id")
        .eq("id", listId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!list) {
        await sb.from("exports").update({ status: "failed", error: "list_not_found" }).eq("id", exportRow.id);
        throw new HttpError(404, "That list wasn't found in this workspace.");
      }
      const { data, error } = await sb
        .from("lead_list_members")
        .select("leads(*)")
        .eq("list_id", listId)
        .limit(50000);
      if (error) throw new HttpError(500, "Couldn't read the leads for this export.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      leads = (data ?? []).map((m: any) => m.leads).filter(Boolean);
    }

    if (!leads.length) {
      await sb.from("exports").update({ status: "failed", error: "no_leads" }).eq("id", exportRow.id);
      return errorJson("There are no leads to export.", 422);
    }

    const header = CSV_COLUMNS.join(",");
    const lines = [header];
    for (const lead of leads) {
      lines.push(CSV_COLUMNS.map((c) => csvEscape(lead[c])).join(","));
    }
    const csv = lines.join("\n");

    await sb
      .from("exports")
      .update({ status: "completed", lead_count: leads.length, csv, completed_at: new Date().toISOString() })
      .eq("id", exportRow.id);

    // usage count: exports
    const period = new Date();
    period.setDate(1);
    await sb
      .from("usage_counters")
      .upsert({ workspace_id: workspaceId, period_start: period.toISOString().slice(0, 10) }, { onConflict: "workspace_id,period_start" });
    const { data: counter } = await sb
      .from("usage_counters")
      .select("exports")
      .eq("workspace_id", workspaceId)
      .eq("period_start", period.toISOString().slice(0, 10))
      .single();
    await sb
      .from("usage_counters")
      .update({ exports: (counter?.exports ?? 0) + 1 })
      .eq("workspace_id", workspaceId)
      .eq("period_start", period.toISOString().slice(0, 10));

    await logActivity(sb, {
      workspaceId,
      actorId: user.id,
      kind: "export",
      text: `Exported ${fileName} (${leads.length} leads)`,
      meta: { exportId: exportRow.id },
    });

    return json({ id: exportRow.id, file_name: exportRow.file_name, lead_count: leads.length, status: "completed", csv });
  } catch (e) {
    return handleError(e);
  }
});
