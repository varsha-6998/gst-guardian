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
    const { score: complianceScore, issues, suggestions } = scoreCompliance(invoice, gstinResult);
    const { fraudScore, fraudRisk, fraudReasons } = await detectFraud(admin, invoice, gstinResult, userId);

    let status: "valid" | "warning" | "error" = "valid";
    if (fraudRisk === "high" || gstinResult.status === "Cancelled" || issues.some((i: string) => i.toLowerCase().includes("invalid gstin"))) {
      status = "error";
    } else if (fraudRisk === "medium" || issues.length > 0 || !gstinResult.verified) {
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
        issues,
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
        issues,
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

function scoreCompliance(invoice: any, gstin: GstinResult) {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  if (!invoice.gstin) {
    issues.push("Missing GSTIN");
    suggestions.push("Add the seller's GSTIN to the invoice.");
    score -= 25;
  } else if (!GSTIN_REGEX.test(invoice.gstin)) {
    issues.push("Invalid GSTIN format");
    suggestions.push("GSTIN must be 15 chars: 2 digits + 5 letters + 4 digits + 1 letter + 1 char + Z + 1 char.");
    score -= 25;
  } else if (!gstin.verified) {
    issues.push("GSTIN could not be verified");
    suggestions.push("Re-check the GSTIN with the seller; it may be inactive or mistyped.");
    score -= 15;
  }

  if (!invoice.invoice_number) { issues.push("Missing invoice number"); score -= 10; }
  if (!invoice.invoice_date) { issues.push("Missing invoice date"); score -= 10; }
  if (!invoice.seller_name) { issues.push("Missing seller name"); score -= 5; }
  if (!invoice.buyer_name) { issues.push("Missing buyer name"); score -= 5; }
  if (invoice.total_amount == null) { issues.push("Missing total amount"); score -= 10; }

  // Tax math check
  const taxable = Number(invoice.taxable_amount ?? 0);
  const cgst = Number(invoice.cgst ?? 0);
  const sgst = Number(invoice.sgst ?? 0);
  const igst = Number(invoice.igst ?? 0);
  const total = Number(invoice.total_amount ?? 0);

  if (taxable && total) {
    const computed = taxable + cgst + sgst + igst;
    const diff = Math.abs(computed - total);
    if (diff > Math.max(1, total * 0.02)) {
      issues.push(`Tax math mismatch: taxable + tax (${computed.toFixed(2)}) ≠ total (${total.toFixed(2)})`);
      suggestions.push("Re-verify CGST/SGST/IGST line items.");
      score -= 10;
    }
  }

  if (cgst > 0 && igst > 0) {
    issues.push("Both intra-state (CGST/SGST) and inter-state (IGST) taxes present");
    suggestions.push("An invoice should use either CGST+SGST or IGST, not both.");
    score -= 10;
  }

  if (gstin.verified && invoice.seller_name && gstin.legal_name) {
    const a = invoice.seller_name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const b = gstin.legal_name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const t = gstin.trade_name?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
    if (!a.includes(b.slice(0, 6)) && !b.includes(a.slice(0, 6)) && !(t && (a.includes(t.slice(0, 6)) || t.includes(a.slice(0, 6))))) {
      issues.push("Seller name doesn't match GST records");
      suggestions.push(`GST registry shows: ${gstin.legal_name}${gstin.trade_name ? ` (${gstin.trade_name})` : ""}`);
      score -= 10;
    }
  }

  return { score: Math.max(0, score), issues, suggestions };
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
