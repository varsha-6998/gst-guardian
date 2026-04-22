// Process invoice with Lovable AI vision OCR + structured extraction
// Returns structured invoice fields. Tesseract fallback runs client-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert at extracting structured data from Indian GST invoices. Extract all fields accurately. Use null for missing fields. Numbers must be plain numbers (no currency symbols/commas). Dates must be YYYY-MM-DD. GSTIN is exactly 15 alphanumeric uppercase chars.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Unauthorized", 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return jsonError("Unauthorized", 401);
    const userId = userData.user.id;

    const { invoiceId, filePath, mimeType, ocrText } = await req.json();
    if (!invoiceId || !filePath) return jsonError("invoiceId and filePath required", 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify ownership
    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .select("user_id, status")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) return jsonError("Invoice not found", 404);
    if (invoice.user_id !== userId) return jsonError("Forbidden", 403);

    let extracted: any = null;
    let usedFallback = false;

    // Try AI vision OCR first
    try {
      const { data: signed } = await admin.storage
        .from("invoices")
        .createSignedUrl(filePath, 300);
      if (!signed?.signedUrl) throw new Error("Could not create signed URL");

      const isImage = (mimeType ?? "").startsWith("image/");
      const messages: any[] = [
        { role: "system", content: SYSTEM_PROMPT },
      ];

      if (isImage) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: "Extract invoice fields from this image." },
            { type: "image_url", image_url: { url: signed.signedUrl } },
          ],
        });
      } else if (ocrText) {
        // PDF or unsupported image - rely on client-side OCR text
        messages.push({
          role: "user",
          content: `Extract invoice fields from this OCR text:\n\n${ocrText.slice(0, 12000)}`,
        });
      } else {
        // Try image_url anyway (Gemini supports PDFs)
        messages.push({
          role: "user",
          content: [
            { type: "text", text: "Extract invoice fields from this document." },
            { type: "image_url", image_url: { url: signed.signedUrl } },
          ],
        });
      }

      const tools = [
        {
          type: "function",
          function: {
            name: "extract_invoice",
            description: "Extract structured fields from an Indian GST invoice.",
            parameters: {
              type: "object",
              properties: {
                gstin: { type: ["string", "null"], description: "Seller GSTIN (15 chars uppercase)" },
                invoice_number: { type: ["string", "null"] },
                invoice_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
                seller_name: { type: ["string", "null"] },
                buyer_name: { type: ["string", "null"] },
                taxable_amount: { type: ["number", "null"] },
                cgst: { type: ["number", "null"] },
                sgst: { type: ["number", "null"] },
                igst: { type: ["number", "null"] },
                total_amount: { type: ["number", "null"] },
                raw_text: { type: ["string", "null"], description: "Brief raw OCR snippet" },
              },
              required: ["gstin", "invoice_number", "total_amount"],
              additionalProperties: false,
            },
          },
        },
      ];

      const aiStart = Date.now();
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools,
          tool_choice: { type: "function", function: { name: "extract_invoice" } },
        }),
      });

      await admin.from("api_usage_logs").insert({
        api_name: "lovable_ai_ocr",
        endpoint: "chat/completions",
        status_code: aiResp.status,
        success: aiResp.ok,
        latency_ms: Date.now() - aiStart,
        user_id: userId,
      });

      if (aiResp.status === 429) {
        return jsonError("AI rate limit exceeded. Please retry in a moment.", 429);
      }
      if (aiResp.status === 402) {
        return jsonError("AI credits exhausted. Add credits in Workspace settings.", 402);
      }
      if (!aiResp.ok) {
        const t = await aiResp.text();
        console.error("AI error:", aiResp.status, t);
        throw new Error(`AI gateway error ${aiResp.status}`);
      }

      const aiJson = await aiResp.json();
      const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("No tool call in AI response");
      extracted = JSON.parse(toolCall.function.arguments);
    } catch (err) {
      console.error("AI OCR failed, using client-OCR fallback path:", err);
      usedFallback = true;
      // If we have ocrText from client, do a basic regex extraction
      if (ocrText) {
        extracted = regexExtract(ocrText);
      } else {
        return jsonError("AI OCR failed and no client OCR text provided", 500);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, extracted, usedFallback }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("process-invoice fatal:", err);
    return jsonError(err instanceof Error ? err.message : "Unknown error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function regexExtract(text: string) {
  const gstinMatch = text.match(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/);
  const invNumMatch = text.match(/(?:Invoice\s*(?:No|Number|#)[:\s]*)([A-Z0-9\-/]+)/i);
  const dateMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  const totalMatch = text.match(/(?:Total|Grand\s*Total|Amount)[:\s]*₹?\s*([\d,]+\.?\d*)/i);
  const cgstMatch = text.match(/CGST[:\s]*₹?\s*([\d,]+\.?\d*)/i);
  const sgstMatch = text.match(/SGST[:\s]*₹?\s*([\d,]+\.?\d*)/i);
  const igstMatch = text.match(/IGST[:\s]*₹?\s*([\d,]+\.?\d*)/i);

  const num = (s?: string) => (s ? parseFloat(s.replace(/,/g, "")) : null);

  let isoDate: string | null = null;
  if (dateMatch) {
    let [_, d, m, y] = dateMatch;
    if (y.length === 2) y = "20" + y;
    isoDate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return {
    gstin: gstinMatch?.[0] ?? null,
    invoice_number: invNumMatch?.[1] ?? null,
    invoice_date: isoDate,
    seller_name: null,
    buyer_name: null,
    taxable_amount: null,
    cgst: num(cgstMatch?.[1]),
    sgst: num(sgstMatch?.[1]),
    igst: num(igstMatch?.[1]),
    total_amount: num(totalMatch?.[1]),
    raw_text: text.slice(0, 500),
  };
}
