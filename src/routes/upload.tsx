import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { UploadCloud, FileCheck2, AlertTriangle, XCircle, Loader2, FileText, Trash2 } from "lucide-react";

export const Route = createFileRoute("/upload")({
  head: () => ({ meta: [{ title: "Upload Invoices — Invoice IQ" }] }),
  component: () => (
    <AppShell>
      <UploadPage />
    </AppShell>
  ),
});

type Stage = "queued" | "splitting" | "hashing" | "uploading" | "ocr" | "verifying" | "done" | "error";

interface Item {
  id: string;
  file: File | Blob;
  fileName: string;
  fileType: string;
  fileSize: number;
  pageInfo?: { page: number; total: number };
  stage: Stage;
  progress: number;
  message?: string;
  invoiceId?: string;
  result?: {
    status: "valid" | "warning" | "error";
    complianceScore: number;
    fraudRisk: "low" | "medium" | "high";
    gstin?: string | null;
    seller?: string | null;
  };
}

const ACCEPTED = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function UploadPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);

  const updateItem = (id: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const processOne = useCallback(
    async (item: Item) => {
      if (!user) return;
      try {
        // 1. Hash for duplicate detection
        updateItem(item.id, { stage: "hashing", progress: 5 });
        const buf = await item.file.arrayBuffer();
        const hashBuf = await crypto.subtle.digest("SHA-256", buf);
        const hashHex = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        // 2. Upload to storage
        updateItem(item.id, { stage: "uploading", progress: 20 });
        const ext = item.fileName.split(".").pop() ?? "bin";
        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("invoices")
          .upload(path, item.file, { contentType: item.fileType, upsert: false });
        if (upErr) throw new Error(upErr.message);

        // 3. Insert invoice row
        const { data: inserted, error: insErr } = await supabase
          .from("invoices")
          .insert({
            user_id: user.id,
            file_path: path,
            file_name: item.fileName,
            file_size: item.fileSize,
            mime_type: item.fileType,
            file_hash: hashHex,
            status: "processing",
          })
          .select("id")
          .single();
        if (insErr || !inserted) throw new Error(insErr?.message ?? "Insert failed");
        updateItem(item.id, { invoiceId: inserted.id, progress: 35 });

        // 4. OCR — try AI first, fall back to Tesseract for non-images or AI failure
        updateItem(item.id, { stage: "ocr", progress: 45, message: "AI extracting fields…" });
        let ocrText: string | undefined;
        const isImage = item.fileType.startsWith("image/");

        let extracted: any = null;
        let usedFallback = false;

        const callProcess = async (textForFallback?: string) => {
          const { data, error } = await supabase.functions.invoke("process-invoice", {
            body: {
              invoiceId: inserted.id,
              filePath: path,
              mimeType: item.fileType,
              ocrText: textForFallback,
            },
          });
          if (error) throw error;
          if ((data as any)?.error) throw new Error((data as any).error);
          return data;
        };

        try {
          const data = await callProcess();
          extracted = data.extracted;
          usedFallback = !!data.usedFallback;
        } catch (e: any) {
          if (isImage) {
            // Tesseract fallback
            updateItem(item.id, { progress: 55, message: "Falling back to Tesseract OCR…" });
            const { default: Tesseract } = await import("tesseract.js");
            const { data: tdata } = await Tesseract.recognize(item.file, "eng");
            ocrText = tdata.text;
            const data = await callProcess(ocrText);
            extracted = data.extracted;
            usedFallback = true;
          } else {
            throw e;
          }
        }

        // 5. Persist extracted fields
        updateItem(item.id, { stage: "verifying", progress: 75, message: "Verifying GSTIN…" });
        await supabase
          .from("invoices")
          .update({
            gstin: extracted?.gstin ?? null,
            invoice_number: extracted?.invoice_number ?? null,
            invoice_date: extracted?.invoice_date ?? null,
            seller_name: extracted?.seller_name ?? null,
            buyer_name: extracted?.buyer_name ?? null,
            taxable_amount: extracted?.taxable_amount ?? null,
            cgst: extracted?.cgst ?? null,
            sgst: extracted?.sgst ?? null,
            igst: extracted?.igst ?? null,
            total_amount: extracted?.total_amount ?? null,
            raw_ocr_text: extracted?.raw_text ?? ocrText ?? null,
          })
          .eq("id", inserted.id);

        // 6. Verify + scoring
        const { data: verifyData, error: verifyErr } = await supabase.functions.invoke("verify-gstin", {
          body: { invoiceId: inserted.id },
        });
        if (verifyErr) throw verifyErr;
        if ((verifyData as any)?.error) throw new Error((verifyData as any).error);

        updateItem(item.id, {
          stage: "done",
          progress: 100,
          message: usedFallback ? "Done (Tesseract fallback)" : "Done",
          result: {
            status: verifyData.status,
            complianceScore: verifyData.complianceScore,
            fraudRisk: verifyData.fraudRisk,
            gstin: extracted?.gstin,
            seller: extracted?.seller_name,
          },
        });
      } catch (err: any) {
        console.error("processOne error:", err);
        updateItem(item.id, {
          stage: "error",
          progress: 100,
          message: err?.message ?? "Failed to process",
        });
      }
    },
    [user],
  );

  const onDrop = useCallback(
    async (accepted: File[]) => {
      // Expand each PDF into one queued item per page; non-PDFs pass through.
      const newItems: Item[] = [];
      for (const f of accepted) {
        if (f.type === "application/pdf") {
          // Insert a placeholder while we split, then replace with per-page items.
          const splittingId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const placeholder: Item = {
            id: splittingId,
            file: f,
            fileName: f.name,
            fileType: f.type,
            fileSize: f.size,
            stage: "splitting",
            progress: 5,
            message: "Splitting PDF pages…",
          };
          setItems((prev) => [placeholder, ...prev]);
          try {
            const { splitPdfToImages } = await import("@/lib/pdf-split");
            const pages = await splitPdfToImages(f);
            const expanded: Item[] = pages.map((p) => ({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              file: p.blob,
              fileName: p.fileName,
              fileType: "image/png",
              fileSize: p.blob.size,
              pageInfo: { page: p.pageNumber, total: p.totalPages },
              stage: "queued",
              progress: 0,
            }));
            setItems((prev) => {
              const idx = prev.findIndex((it) => it.id === splittingId);
              if (idx === -1) return [...expanded, ...prev];
              return [...prev.slice(0, idx), ...expanded, ...prev.slice(idx + 1)];
            });
            expanded.forEach((it) => processOne(it));
          } catch (err: any) {
            toast.error(`Could not split ${f.name}: ${err?.message ?? "PDF read failed"}`);
            setItems((prev) =>
              prev.map((it) =>
                it.id === splittingId
                  ? { ...it, stage: "error", progress: 100, message: err?.message ?? "Split failed" }
                  : it,
              ),
            );
          }
        } else {
          newItems.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            file: f,
            fileName: f.name,
            fileType: f.type,
            fileSize: f.size,
            stage: "queued",
            progress: 0,
          });
        }
      }
      if (newItems.length) {
        setItems((prev) => [...newItems, ...prev]);
        newItems.forEach((it) => processOne(it));
      }
    },
    [processOne],
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxSize: MAX_SIZE,
    multiple: true,
  });

  if (fileRejections.length > 0) {
    const msg = fileRejections[0].errors[0]?.message ?? "File rejected";
    toast.error(msg);
  }

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Upload Invoices</h1>
        <p className="text-muted-foreground mt-1">
          Drag &amp; drop PDFs or images. We&apos;ll run AI OCR, verify GSTINs, and score compliance & fraud risk in real time.
        </p>
      </header>

      <div
        {...getRootProps()}
        className={`relative rounded-3xl border-2 border-dashed p-12 text-center transition-all cursor-pointer ${
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border bg-gradient-card hover:border-primary/60"
        }`}
      >
        <input {...getInputProps()} />
        <UploadCloud className="h-12 w-12 mx-auto text-primary mb-4" />
        <h2 className="text-xl font-semibold">
          {isDragActive ? "Drop to upload" : "Drag invoices here, or click to browse"}
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          PDF, JPG, PNG, WEBP · up to 10MB · multiple files supported
        </p>
        <Button type="button" className="mt-6 shadow-glow">
          Choose files
        </Button>
      </div>

      {items.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Processing queue</h2>
            <Button variant="ghost" size="sm" onClick={() => setItems([])}>
              <Trash2 className="h-4 w-4 mr-1" /> Clear
            </Button>
          </div>
          {items.map((it) => (
            <ItemRow key={it.id} item={it} />
          ))}
        </section>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: Item }) {
  const Icon =
    item.stage === "done"
      ? FileCheck2
      : item.stage === "error"
      ? XCircle
      : item.stage === "verifying" || item.stage === "ocr" || item.stage === "uploading" || item.stage === "hashing"
      ? Loader2
      : FileText;
  const spinning = ["hashing", "uploading", "ocr", "verifying"].includes(item.stage);
  const statusColor =
    item.result?.status === "valid"
      ? "bg-success/15 text-success border-success/30"
      : item.result?.status === "warning"
      ? "bg-warning/15 text-warning border-warning/30"
      : item.result?.status === "error"
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : "";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Icon className={`h-5 w-5 shrink-0 ${spinning ? "animate-spin text-primary" : item.stage === "done" ? "text-success" : item.stage === "error" ? "text-destructive" : "text-muted-foreground"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{item.file.name}</p>
            <span className="text-xs text-muted-foreground">
              {(item.file.size / 1024).toFixed(0)} KB
            </span>
            {item.result && (
              <Badge variant="outline" className={statusColor}>
                {item.result.status}
              </Badge>
            )}
            {item.result && (
              <Badge variant="outline" className="border-border">
                Compliance {item.result.complianceScore}/100
              </Badge>
            )}
            {item.result && (
              <Badge
                variant="outline"
                className={
                  item.result.fraudRisk === "high"
                    ? "border-destructive/30 text-destructive"
                    : item.result.fraudRisk === "medium"
                    ? "border-warning/30 text-warning"
                    : "border-success/30 text-success"
                }
              >
                Fraud: {item.result.fraudRisk}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.message ?? stageLabel(item.stage)}
          </p>
          <Progress value={item.progress} className="h-1.5 mt-2" />
        </div>
        {item.stage === "done" && item.invoiceId && (
          <Link to="/invoices">
            <Button size="sm" variant="outline">
              View
            </Button>
          </Link>
        )}
        {item.stage === "error" && (
          <AlertTriangle className="h-5 w-5 text-destructive" />
        )}
      </div>
    </div>
  );
}

function stageLabel(s: Stage) {
  switch (s) {
    case "queued": return "Queued";
    case "hashing": return "Hashing file…";
    case "uploading": return "Uploading…";
    case "ocr": return "Extracting fields…";
    case "verifying": return "Verifying GSTIN & scoring…";
    case "done": return "Complete";
    case "error": return "Failed";
  }
}
