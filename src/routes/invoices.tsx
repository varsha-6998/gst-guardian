import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import {
  Search, Download, Trash2, FileText, Loader2, Eye, ShieldAlert, ShieldCheck,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/invoices")({
  head: () => ({ meta: [{ title: "Invoices — Invoice IQ" }] }),
  component: () => (
    <AppShell>
      <InvoicesPage />
    </AppShell>
  ),
});

interface Invoice {
  id: string;
  file_name: string;
  file_path: string;
  status: "processing" | "valid" | "warning" | "error";
  fraud_risk: "low" | "medium" | "high" | null;
  fraud_score: number | null;
  compliance_score: number | null;
  gstin: string | null;
  gstin_verified: boolean | null;
  gstin_legal_name: string | null;
  gstin_trade_name: string | null;
  gstin_status: string | null;
  gstin_source: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  seller_name: string | null;
  buyer_name: string | null;
  taxable_amount: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  total_amount: number | null;
  issues: string[] | null;
  suggestions: string[] | null;
  fraud_reasons: string[] | null;
  created_at: string;
}

function InvoicesPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "valid" | "warning" | "error">("all");
  const [selected, setSelected] = useState<Invoice | null>(null);

  const refresh = async () => {
    const { data } = await supabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as any);
  };

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (q) {
        const s = q.toLowerCase();
        return (
          r.seller_name?.toLowerCase().includes(s) ||
          r.invoice_number?.toLowerCase().includes(s) ||
          r.gstin?.toLowerCase().includes(s) ||
          r.file_name.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [rows, q, filter]);

  const handleDelete = async (id: string, path: string) => {
    if (!confirm("Delete this invoice? This cannot be undone.")) return;
    await supabase.storage.from("invoices").remove([path]);
    const { error } = await supabase.from("invoices").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Invoice deleted");
      refresh();
    }
  };

  const exportPdf = async () => {
    if (!rows || rows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Invoice IQ — Compliance Report", 14, 16);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, 14, 22);
    doc.text(`Total: ${rows.length} invoices`, 14, 28);

    autoTable(doc, {
      startY: 34,
      head: [["Date", "Seller", "GSTIN", "Inv #", "Total", "Compliance", "Risk", "Status"]],
      body: rows.map((r) => [
        r.invoice_date ?? r.created_at.slice(0, 10),
        (r.seller_name ?? "—").slice(0, 24),
        r.gstin ?? "—",
        r.invoice_number ?? "—",
        r.total_amount != null ? `Rs.${Number(r.total_amount).toFixed(2)}` : "—",
        r.compliance_score != null ? `${r.compliance_score}/100` : "—",
        r.fraud_risk ?? "—",
        r.status,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [16, 79, 56] },
    });

    doc.save(`invoice-iq-report-${Date.now()}.pdf`);
  };

  if (rows === null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold">Invoices</h1>
          <p className="text-muted-foreground mt-1">{rows.length} total · {filtered.length} shown</p>
        </div>
        <Button onClick={exportPdf} variant="outline">
          <Download className="h-4 w-4 mr-2" /> Export PDF report
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search seller, GSTIN, invoice number…" className="pl-9" />
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {(["all", "valid", "warning", "error"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center bg-gradient-card">
          <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No invoices match your filters.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">Seller / GSTIN</th>
                  <th className="text-left px-4 py-3">Invoice #</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Total</th>
                  <th className="text-center px-4 py-3">Compliance</th>
                  <th className="text-center px-4 py-3">Fraud</th>
                  <th className="text-center px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-[200px]">{r.seller_name ?? r.file_name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{r.gstin ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 font-mono">{r.invoice_number ?? "—"}</td>
                    <td className="px-4 py-3">{r.invoice_date ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {r.total_amount != null ? `₹${Number(r.total_amount).toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center font-mono">
                      {r.compliance_score != null ? `${r.compliance_score}/100` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.fraud_risk && <RiskBadge risk={r.fraud_risk} />}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setSelected(r)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(r.id, r.file_path)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <InvoiceDetail invoice={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function StatusBadge({ status }: { status: Invoice["status"] }) {
  const map: Record<string, string> = {
    valid: "bg-success/15 text-success border-success/30",
    warning: "bg-warning/15 text-warning border-warning/30",
    error: "bg-destructive/15 text-destructive border-destructive/30",
    processing: "bg-muted text-muted-foreground border-border",
  };
  return <Badge variant="outline" className={map[status]}>{status}</Badge>;
}

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  const map = {
    low: "bg-success/15 text-success border-success/30",
    medium: "bg-warning/15 text-warning border-warning/30",
    high: "bg-destructive/15 text-destructive border-destructive/30",
  };
  return <Badge variant="outline" className={map[risk]}>{risk}</Badge>;
}

function InvoiceDetail({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!invoice) { setSignedUrl(null); return; }
    (async () => {
      const { data } = await supabase.storage.from("invoices").createSignedUrl(invoice.file_path, 600);
      setSignedUrl(data?.signedUrl ?? null);
    })();
  }, [invoice]);

  if (!invoice) return null;

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {invoice.gstin_verified ? <ShieldCheck className="h-5 w-5 text-success" /> : <ShieldAlert className="h-5 w-5 text-warning" />}
            {invoice.seller_name ?? invoice.file_name}
          </DialogTitle>
          <DialogDescription className="font-mono">{invoice.gstin ?? "No GSTIN"}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          <div className="space-y-4">
            <Field label="Invoice number" value={invoice.invoice_number} />
            <Field label="Invoice date" value={invoice.invoice_date} />
            <Field label="Buyer" value={invoice.buyer_name} />
            <Field label="Taxable amount" value={invoice.taxable_amount != null ? `₹${Number(invoice.taxable_amount).toLocaleString("en-IN")}` : null} mono />
            <div className="grid grid-cols-3 gap-2">
              <Field label="CGST" value={invoice.cgst != null ? `₹${invoice.cgst}` : null} mono small />
              <Field label="SGST" value={invoice.sgst != null ? `₹${invoice.sgst}` : null} mono small />
              <Field label="IGST" value={invoice.igst != null ? `₹${invoice.igst}` : null} mono small />
            </div>
            <Field label="Total" value={invoice.total_amount != null ? `₹${Number(invoice.total_amount).toLocaleString("en-IN")}` : null} mono />

            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground tracking-wider mb-2">GSTIN Verification</p>
              <p className="text-sm">{invoice.gstin_legal_name ?? "—"}</p>
              {invoice.gstin_trade_name && <p className="text-xs text-muted-foreground">Trade: {invoice.gstin_trade_name}</p>}
              <div className="flex gap-2 mt-2">
                {invoice.gstin_status && <Badge variant="outline">{invoice.gstin_status}</Badge>}
                {invoice.gstin_source && <Badge variant="outline" className="text-xs">via {invoice.gstin_source}</Badge>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-xs uppercase text-muted-foreground">Compliance</p>
                <p className="font-mono text-2xl font-bold text-primary mt-1">{invoice.compliance_score ?? "—"}<span className="text-xs">/100</span></p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-xs uppercase text-muted-foreground">Fraud risk</p>
                <p className="font-mono text-2xl font-bold mt-1 capitalize">{invoice.fraud_risk ?? "—"}</p>
              </div>
            </div>

            {invoice.issues && invoice.issues.length > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground tracking-wider mb-2">Issues</p>
                <ul className="space-y-1 text-sm">
                  {invoice.issues.map((i, idx) => <li key={idx} className="text-warning">• {i}</li>)}
                </ul>
              </div>
            )}
            {invoice.fraud_reasons && invoice.fraud_reasons.length > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground tracking-wider mb-2">Fraud signals</p>
                <ul className="space-y-1 text-sm">
                  {invoice.fraud_reasons.map((i, idx) => <li key={idx} className="text-destructive">• {i}</li>)}
                </ul>
              </div>
            )}
            {invoice.suggestions && invoice.suggestions.length > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground tracking-wider mb-2">Suggestions</p>
                <ul className="space-y-1 text-sm">
                  {invoice.suggestions.map((i, idx) => <li key={idx} className="text-muted-foreground">• {i}</li>)}
                </ul>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-muted/20 overflow-hidden min-h-[400px]">
            {signedUrl ? (
              signedUrl.toLowerCase().includes(".pdf") ? (
                <iframe src={signedUrl} className="w-full h-full min-h-[500px]" title="Invoice" />
              ) : (
                <img src={signedUrl} alt="Invoice" className="w-full h-auto" />
              )
            ) : (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, mono, small }: { label: string; value: string | null; mono?: boolean; small?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground tracking-wider">{label}</p>
      <p className={`${mono ? "font-mono" : ""} ${small ? "text-sm" : "text-base"} font-medium mt-0.5`}>{value ?? "—"}</p>
    </div>
  );
}
