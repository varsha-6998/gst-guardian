import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import {
  Search, Download, Trash2, FileText, Loader2, Eye, ShieldAlert, ShieldCheck,
  RefreshCw, MoreHorizontal, FileSpreadsheet, FileDown, ChevronDown,
  XCircle, AlertTriangle, Lightbulb, CheckCircle2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Invoice, ValidationItem } from "@/lib/invoice-types";
import { exportBulkPdf, exportCsv, exportXlsx } from "@/lib/export-utils";

export const Route = createFileRoute("/invoices")({
  head: () => ({ meta: [{ title: "Invoices — Invoice IQ" }] }),
  component: () => (
    <AppShell>
      <InvoicesPage />
    </AppShell>
  ),
});

function InvoicesPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "valid" | "warning" | "error">("all");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);

  const refresh = async () => {
    const { data } = await supabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as any);
  };

  useEffect(() => {
    if (!user) return;
    refresh();
    // Realtime: react to inserts/updates/deletes for this user's invoices
    const channel = supabase
      .channel("invoices-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoices", filter: `user_id=eq.${user.id}` },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
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

  const allSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selectedIds);
      filtered.forEach((r) => next.delete(r.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filtered.forEach((r) => next.add(r.id));
      setSelectedIds(next);
    }
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };
  const clearSelection = () => setSelectedIds(new Set());

  const targetRows = (): Invoice[] =>
    selectedIds.size > 0 ? filtered.filter((r) => selectedIds.has(r.id)) : filtered;

  const handleBulkDelete = async (ids: string[]) => {
    setBulkBusy(true);
    try {
      const targets = (rows ?? []).filter((r) => ids.includes(r.id));
      const paths = targets.map((r) => r.file_path);
      if (paths.length) await supabase.storage.from("invoices").remove(paths);
      const { error } = await supabase.from("invoices").delete().in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} invoice${ids.length > 1 ? "s" : ""} deleted`);
      clearSelection();
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk delete failed");
    } finally {
      setBulkBusy(false);
      setConfirmDelete(null);
    }
  };

  const handleBulkReverify = async () => {
    const targets = targetRows();
    if (targets.length === 0) return toast.error("Nothing to re-verify");
    setBulkBusy(true);
    let ok = 0, fail = 0;
    toast.info(`Re-verifying ${targets.length} invoice${targets.length > 1 ? "s" : ""}…`);
    // Sequential to be gentle on the API
    for (const inv of targets) {
      try {
        const { error } = await supabase.functions.invoke("verify-gstin", {
          body: { invoiceId: inv.id },
        });
        if (error) throw error;
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(false);
    if (fail === 0) toast.success(`Re-verified ${ok} invoice${ok > 1 ? "s" : ""}`);
    else toast.warning(`Re-verified ${ok}, ${fail} failed`);
    refresh();
  };

  const handleExport = async (kind: "csv" | "xlsx" | "pdf") => {
    const targets = targetRows();
    if (targets.length === 0) return toast.error("Nothing to export");
    try {
      if (kind === "csv") exportCsv(targets);
      else if (kind === "xlsx") await exportXlsx(targets);
      else await exportBulkPdf(targets);
      toast.success(`Exported ${targets.length} invoice${targets.length > 1 ? "s" : ""}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    }
  };

  if (rows === null) {
    return (
      <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold">Invoices</h1>
          <p className="text-muted-foreground mt-1">
            {rows.length} total · {filtered.length} shown
            {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Download className="h-4 w-4 mr-2" /> Export
                <ChevronDown className="h-4 w-4 ml-1 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                {selectedIds.size > 0 ? `Selected (${selectedIds.size})` : `All filtered (${filtered.length})`}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleExport("pdf")}>
                <FileText className="h-4 w-4 mr-2" /> PDF compliance report
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("xlsx")}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("csv")}>
                <FileDown className="h-4 w-4 mr-2" /> CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap animate-in fade-in slide-in-from-top-1">
          <p className="text-sm">
            <span className="font-semibold text-primary">{selectedIds.size}</span> selected
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={handleBulkReverify} disabled={bulkBusy}>
              {bulkBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Re-verify
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleExport("pdf")}>
              <FileText className="h-4 w-4 mr-2" /> PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleExport("xlsx")}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete({ ids: Array.from(selectedIds) })}
              disabled={bulkBusy}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </div>
      )}

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
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="text-left px-4 py-3">Seller / GSTIN</th>
                  <th className="text-left px-4 py-3">Invoice #</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Date</th>
                  <th className="text-right px-4 py-3">Total</th>
                  <th className="text-center px-4 py-3 hidden lg:table-cell">Compliance</th>
                  <th className="text-center px-4 py-3 hidden lg:table-cell">Fraud</th>
                  <th className="text-center px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => {
                  const isSel = selectedIds.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className={`hover:bg-muted/20 transition-colors ${isSel ? "bg-primary/5" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={isSel}
                          onCheckedChange={() => toggleOne(r.id)}
                          aria-label={`Select ${r.file_name}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-[200px]">{r.seller_name ?? r.file_name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{r.gstin ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3 font-mono">{r.invoice_number ?? "—"}</td>
                      <td className="px-4 py-3 hidden md:table-cell">{r.invoice_date ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {r.total_amount != null ? `₹${Number(r.total_amount).toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-center font-mono hidden lg:table-cell">
                        {r.compliance_score != null ? `${r.compliance_score}/100` : "—"}
                      </td>
                      <td className="px-4 py-3 text-center hidden lg:table-cell">
                        {r.fraud_risk && <RiskBadge risk={r.fraud_risk} />}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadgeWithCounts status={r.status} issues={r.issues} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelected(r)}
                            title="View details"
                          >
                            <Eye className="h-4 w-4 mr-1" /> Details
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={async () => {
                                  toast.info("Re-verifying…");
                                  const { error } = await supabase.functions.invoke("verify-gstin", {
                                    body: { invoiceId: r.id },
                                  });
                                  if (error) toast.error(error.message);
                                  else { toast.success("Re-verified"); refresh(); }
                                }}
                              >
                                <RefreshCw className="h-4 w-4 mr-2" /> Re-verify
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setConfirmDelete({ ids: [r.id] })}
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <InvoiceDetail invoice={selected} onClose={() => setSelected(null)} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {confirmDelete?.ids.length} invoice{(confirmDelete?.ids.length ?? 0) > 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the file{(confirmDelete?.ids.length ?? 0) > 1 ? "s" : ""} from storage and
              all extracted data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && handleBulkDelete(confirmDelete.ids)}
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
              <div className="flex gap-2 mt-2 flex-wrap">
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

            <ValidationBreakdown items={invoice.issues} suggestions={invoice.suggestions} />

            {invoice.fraud_reasons && invoice.fraud_reasons.length > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground tracking-wider mb-2">Fraud signals</p>
                <ul className="space-y-1 text-sm">
                  {invoice.fraud_reasons.map((i, idx) => <li key={idx} className="text-destructive">• {i}</li>)}
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
