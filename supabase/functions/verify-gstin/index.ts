// Verify GSTIN: cache -> GSTINCheck API -> local fallback table.
// Also runs compliance + fraud scoring and persists to invoices row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GST_API_KEY = Deno.env.get("GST_API_KEY");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Unauthorized", 401);

    const userClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return jsonError("Unauthorized", 401);
    const userId = userData.user.id;

    const { invoiceId } = await req.json();
    if (!invoiceId) return jsonError("invoiceId required", 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) return jsonError("Invoice not found", 404);
    if (invoice.user_id !== userId) return jsonError("Forbidden", 403);

    const gstin = (invoice.gstin ?? "").toUpperCase().trim();

    // Check API toggle
    const { data: setting } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "gstin_api_enabled")
      .maybeSingle();
    const apiEnabled = setting?.value === true || setting?.value === "true" || setting === null;

    let gstinResult: GstinResult = {
      gstin,
      verified: false,
      legal_name: null,
      trade_name: null,
      status: null,
      source: "none",
    };

    if (gstin && GSTIN_REGEX.test(gstin)) {
      gstinResult = await verifyGstin(admin, gstin, GST_API_KEY, apiEnabled, userId);
    }

    // Compliance + fraud scoring
    const { score: complianceScore, items, issues, suggestions } = scoreCompliance(invoice, gstinResult);
    const { fraudScore, fraudRisk, fraudReasons } = await detectFraud(admin, invoice, gstinResult, userId);

    const errors = items.filter((i) => i.severity === "error");
    const warnings = items.filter((i) => i.severity === "warning");

    let status: "valid" | "warning" | "error" = "valid";
    if (errors.length > 0 || fraudRisk === "high" || gstinResult.status === "Cancelled") {
      status = "error";
    } else if (warnings.length > 0 || fraudRisk === "medium" || !gstinResult.verified) {
      status = "warning";
    }

    await admin
      .from("invoices")
      .update({
        gstin_verified: gstinResult.verified,
        gstin_legal_name: gstinResult.legal_name,
        gstin_trade_name: gstinResult.trade_name,
        gstin_status: gstinResult.status,
        gstin_source: gstinResult.source,
        compliance_score: complianceScore,
        fraud_score: fraudScore,
        fraud_risk: fraudRisk,
        fraud_reasons: fraudReasons,
        issues: items, // structured items stored in jsonb
        suggestions,
        status,
      })
      .eq("id", invoiceId);

    return new Response(
      JSON.stringify({
        ok: true,
        gstin: gstinResult,
        complianceScore,
        fraudScore,
        fraudRisk,
        status,
        errors,
        warnings,
        issues, // back-compat flat strings
        suggestions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("verify-gstin fatal:", err);
    return jsonError(err instanceof Error ? err.message : "Unknown error", 500);
  }
});

interface GstinResult {
  gstin: string;
  verified: boolean;
  legal_name: string | null;
  trade_name: string | null;
  status: string | null;
  source: "cache" | "api" | "fallback" | "none";
}

async function verifyGstin(
  admin: any,
  gstin: string,
  apiKey: string | undefined,
  apiEnabled: boolean,
  userId: string,
): Promise<GstinResult> {
  // 1. Cache
  const { data: cached } = await admin
    .from("gstin_cache")
    .select("*")
    .eq("gstin", gstin)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (cached) {
    return {
      gstin,
      verified: cached.status === "Active",
      legal_name: cached.legal_name,
      trade_name: cached.trade_name,
      status: cached.status,
      source: "cache",
    };
  }

  // 2. API
  if (apiEnabled && apiKey) {
    const start = Date.now();
    try {
      const url = `https://sheet.gstincheck.co.in/check/${apiKey}/${gstin}`;
      const resp = await fetch(url);
      const json: any = await resp.json().catch(() => ({}));
      await admin.from("api_usage_logs").insert({
        api_name: "gstincheck",
        endpoint: "check",
        status_code: resp.status,
        success: resp.ok && json?.flag === true,
        latency_ms: Date.now() - start,
        user_id: userId,
      });

      if (resp.ok && json?.flag === true && json?.data) {
        const d = json.data;
        const legal = d.lgnm ?? d.legalName ?? null;
        const trade = d.tradeNam ?? d.tradeName ?? null;
        const status = d.sts ?? d.status ?? "Unknown";
        await admin.from("gstin_cache").upsert({
          gstin,
          legal_name: legal,
          trade_name: trade,
          status,
          raw_response: json,
        });
        return {
          gstin,
          verified: status === "Active",
          legal_name: legal,
          trade_name: trade,
          status,
          source: "api",
        };
      }
    } catch (e) {
      console.error("GSTIN API error:", e);
      await admin.from("api_usage_logs").insert({
        api_name: "gstincheck",
        endpoint: "check",
        success: false,
        error_message: e instanceof Error ? e.message : "unknown",
        latency_ms: Date.now() - start,
        user_id: userId,
      });
    }
  }

  // 3. Fallback table
  const { data: fb } = await admin
    .from("gstin_fallback")
    .select("*")
    .eq("gstin", gstin)
    .maybeSingle();
  if (fb) {
    return {
      gstin,
      verified: fb.status === "Active",
      legal_name: fb.legal_name,
      trade_name: fb.trade_name,
      status: fb.status,
      source: "fallback",
    };
  }

  return { gstin, verified: false, legal_name: null, trade_name: null, status: null, source: "none" };
}

interface ValidationItem {
  severity: "error" | "warning";
  field: string;
  issue: string;
  message: string;
  suggestion?: string;
}

function scoreCompliance(invoice: any, gstin: GstinResult) {
  const items: ValidationItem[] = [];
  let score = 100;

  // ---------- ERRORS (critical) ----------
  if (!invoice.gstin) {
    items.push({
      severity: "error",
      field: "GSTIN",
      issue: "Missing GSTIN",
      message: "No GSTIN was found on this invoice. GSTIN is mandatory for B2B GST invoices.",
      suggestion: "Add the seller's 15-character GSTIN to the invoice.",
    });
    score -= 25;
  } else if (!GSTIN_REGEX.test(invoice.gstin)) {
    items.push({
      severity: "error",
      field: "GSTIN",
      issue: "Invalid GSTIN format",
      message: `"${invoice.gstin}" does not follow the standard 15-character GSTIN structure.`,
      suggestion: "GSTIN must be 15 chars: 2 digits + 5 letters + 4 digits + 1 letter + 1 char + Z + 1 char. Example: 29ABCDE1234F1Z5",
    });
    score -= 25;
  } else if (gstin.status && gstin.status !== "Active") {
    items.push({
      severity: "error",
      field: "GSTIN",
      issue: `GSTIN status is ${gstin.status}`,
      message: `The GSTIN is registered but its current status is "${gstin.status}". Invoices from inactive GSTINs may be rejected.`,
      suggestion: "Confirm with the seller; you may need an updated GSTIN.",
    });
    score -= 20;
  }

  if (!invoice.invoice_number) {
    items.push({
      severity: "error",
      field: "Invoice Number",
      issue: "Missing invoice number",
      message: "Every tax invoice must have a unique sequential invoice number.",
      suggestion: "Request a corrected invoice that includes the invoice number.",
    });
    score -= 10;
  }
  if (!invoice.invoice_date) {
    items.push({
      severity: "error",
      field: "Invoice Date",
      issue: "Missing invoice date",
      message: "Invoice date is required for GST filing and ITC claims.",
      suggestion: "Ensure the issue date is printed on the invoice.",
    });
    score -= 10;
  }
  if (invoice.total_amount == null) {
    items.push({
      severity: "error",
      field: "Total Amount",
      issue: "Missing total amount",
      message: "The invoice does not state a final payable total.",
      suggestion: "Verify totals; request a corrected invoice if absent.",
    });
    score -= 10;
  }

  // Tax math check (treat large mismatch as error, small as warning)
  const taxable = Number(invoice.taxable_amount ?? 0);
  const cgst = Number(invoice.cgst ?? 0);
  const sgst = Number(invoice.sgst ?? 0);
  const igst = Number(invoice.igst ?? 0);
  const total = Number(invoice.total_amount ?? 0);

  if (taxable && total) {
    const computed = taxable + cgst + sgst + igst;
    const diff = Math.abs(computed - total);
    const tolerance = Math.max(1, total * 0.02);
    if (diff > tolerance * 5) {
      items.push({
        severity: "error",
        field: "Tax Calculation",
        issue: "Tax calculation incorrect",
        message: `Taxable + tax components (₹${computed.toFixed(2)}) do not match the stated total (₹${total.toFixed(2)}). Difference: ₹${diff.toFixed(2)}.`,
        suggestion: "Re-verify CGST/SGST/IGST line items and the taxable value.",
      });
      score -= 15;
    } else if (diff > tolerance) {
      items.push({
        severity: "warning",
        field: "Tax Calculation",
        issue: "Minor tax mismatch",
        message: `Small rounding difference: computed ₹${computed.toFixed(2)} vs. stated ₹${total.toFixed(2)}.`,
        suggestion: "Likely rounding — confirm with the seller if material.",
      });
      score -= 5;
    }
  }

  if (cgst > 0 && igst > 0) {
    items.push({
      severity: "error",
      field: "Tax Type",
      issue: "Both CGST/SGST and IGST present",
      message: "An invoice should use either intra-state (CGST + SGST) or inter-state (IGST) taxes — not both.",
      suggestion: "Identify the place of supply and request a corrected invoice with the correct tax type.",
    });
    score -= 10;
  }

  // ---------- WARNINGS (non-critical) ----------
  if (invoice.gstin && GSTIN_REGEX.test(invoice.gstin) && !gstin.verified && gstin.status !== "Cancelled" && gstin.status !== "Suspended") {
    items.push({
      severity: "warning",
      field: "GSTIN",
      issue: "GSTIN could not be verified",
      message: "We couldn't confirm this GSTIN against the live registry. It may be valid but unreachable, or recently issued.",
      suggestion: "Re-check the GSTIN with the seller; retry verification in a few minutes.",
    });
    score -= 10;
  }

  if (!invoice.seller_name) {
    items.push({
      severity: "warning",
      field: "Seller Name",
      issue: "Missing seller name",
      message: "Seller's legal name was not detected on the invoice.",
      suggestion: "Confirm seller details from the GST registry.",
    });
    score -= 5;
  }
  if (!invoice.buyer_name) {
    items.push({
      severity: "warning",
      field: "Buyer Name",
      issue: "Missing buyer name",
      message: "Buyer details are required for ITC claims.",
      suggestion: "Verify the buyer block on the invoice.",
    });
    score -= 5;
  }

  if (gstin.verified && invoice.seller_name && gstin.legal_name) {
    const a = invoice.seller_name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const b = gstin.legal_name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const t = gstin.trade_name?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
    if (!a.includes(b.slice(0, 6)) && !b.includes(a.slice(0, 6)) && !(t && (a.includes(t.slice(0, 6)) || t.includes(a.slice(0, 6))))) {
      items.push({
        severity: "warning",
        field: "Seller Name",
        issue: "Name mismatch with GST records",
        message: `Invoice shows "${invoice.seller_name}" but GST registry has "${gstin.legal_name}"${gstin.trade_name ? ` (trade name: ${gstin.trade_name})` : ""}.`,
        suggestion: "Verify the seller name or GSTIN — they should match the registry.",
      });
      score -= 10;
    }
  }

  // Old invoice date warning
  if (invoice.invoice_date) {
    const d = new Date(invoice.invoice_date);
    const ageDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 365) {
      items.push({
        severity: "warning",
        field: "Invoice Date",
        issue: "Old invoice date",
        message: `Invoice is dated ${invoice.invoice_date} (${Math.round(ageDays)} days old). ITC claims have time limits.`,
        suggestion: "Confirm the date is correct; check ITC eligibility windows.",
      });
      score -= 3;
    }
  }

  // Back-compat: also produce flat string arrays for older consumers.
  const issues = items.map((i) => `${i.field}: ${i.issue}`);
  const suggestions = items.filter((i) => i.suggestion).map((i) => i.suggestion as string);

  return { score: Math.max(0, score), items, issues, suggestions };
}

async function detectFraud(admin: any, invoice: any, gstin: GstinResult, userId: string) {
  const reasons: string[] = [];
  let fraudScore = 0;

  if (gstin.gstin && !gstin.verified && invoice.gstin) {
    reasons.push("GSTIN could not be verified against registry");
    fraudScore += 20;
  }
  if (gstin.status && gstin.status !== "Active") {
    reasons.push(`GSTIN status is ${gstin.status}`);
    fraudScore += 35;
  }
  if (gstin.verified && invoice.seller_name && gstin.legal_name) {
    const a = invoice.seller_name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const b = gstin.legal_name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!a.includes(b.slice(0, 6)) && !b.includes(a.slice(0, 6))) {
      reasons.push("Seller name mismatch with GST records");
      fraudScore += 25;
    }
  }

  // Duplicate by hash
  if (invoice.file_hash) {
    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("file_hash", invoice.file_hash)
      .neq("id", invoice.id);
    if ((count ?? 0) > 0) {
      reasons.push("Duplicate invoice file detected");
      fraudScore += 30;
    }
  }

  // Duplicate invoice number with same GSTIN
  if (invoice.invoice_number && invoice.gstin) {
    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("invoice_number", invoice.invoice_number)
      .eq("gstin", invoice.gstin)
      .neq("id", invoice.id);
    if ((count ?? 0) > 0) {
      reasons.push("Duplicate invoice number for same seller");
      fraudScore += 25;
    }
  }

  // Abnormal tax rate
  const taxable = Number(invoice.taxable_amount ?? 0);
  const taxes = Number(invoice.cgst ?? 0) + Number(invoice.sgst ?? 0) + Number(invoice.igst ?? 0);
  if (taxable > 0) {
    const rate = (taxes / taxable) * 100;
    if (rate > 35 || (rate > 0 && rate < 0.5)) {
      reasons.push(`Unusual effective tax rate: ${rate.toFixed(1)}%`);
      fraudScore += 15;
    }
  }

  fraudScore = Math.min(100, fraudScore);
  const fraudRisk: "low" | "medium" | "high" =
    fraudScore >= 50 ? "high" : fraudScore >= 25 ? "medium" : "low";

  return { fraudScore, fraudRisk, fraudReasons: reasons };
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
