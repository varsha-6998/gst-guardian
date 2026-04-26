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
  XCircle, AlertTriangle, Lightbulb, CheckCircle2, Pencil, Save, X,
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
                        <div className="inline-flex items-center gap-2">
                          <StatusBadgeWithCounts status={r.status} issues={r.issues} />
                          {(r.status === "error" || isStuck(r)) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              title={isStuck(r) ? "Stuck for >2 min — retry verification" : "Retry verification"}
                              onClick={async () => {
                                toast.info("Retrying…");
                                const { error } = await supabase.functions.invoke("verify-gstin", {
                                  body: { invoiceId: r.id },
                                });
                                if (error) toast.error(error.message);
                                else { toast.success("Retried"); refresh(); }
                              }}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" /> Retry
                            </Button>
                          )}
                        </div>
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

// Treat invoices stuck >2 minutes in `processing` as retryable.
function isStuck(r: Invoice): boolean {
  if (r.status !== "processing") return false;
  const age = Date.now() - new Date(r.created_at).getTime();
  return age > 2 * 60 * 1000;
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
  const [editingGstin, setEditingGstin] = useState(false);
  const [gstinDraft, setGstinDraft] = useState("");
  const [savingGstin, setSavingGstin] = useState(false);

  useEffect(() => {
    if (!invoice) { setSignedUrl(null); return; }
    setEditingGstin(false);
    setGstinDraft(invoice.gstin ?? "");
    (async () => {
      const { data } = await supabase.storage.from("invoices").createSignedUrl(invoice.file_path, 600);
      setSignedUrl(data?.signedUrl ?? null);
    })();
  }, [invoice]);

  if (!invoice) return null;

  const isPdf = (invoice.file_name ?? "").toLowerCase().endsWith(".pdf");

  // Update a single field on the invoice. Numbers are coerced; empty strings become null.
  // After saving, kick off re-verification so compliance score / fraud risk / status stay consistent.
  const saveField = async (
    field: keyof Invoice,
    raw: string,
    kind: "text" | "number" | "date",
  ) => {
    let value: string | number | null = raw.trim() === "" ? null : raw.trim();
    if (value !== null && kind === "number") {
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error("Must be a number");
      value = n;
    }
    if (value !== null && kind === "date") {
      // Expect YYYY-MM-DD from <input type="date">
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error("Invalid date");
    }
    const { error: upErr } = await supabase
      .from("invoices")
      .update({ [field]: value } as any)
      .eq("id", invoice.id);
    if (upErr) throw upErr;
    const { error: vErr } = await supabase.functions.invoke("verify-gstin", {
      body: { invoiceId: invoice.id },
    });
    if (vErr) throw vErr;
  };

  const saveAndReverify = async () => {
    const next = gstinDraft.trim().toUpperCase();
    if (!next) return toast.error("GSTIN cannot be empty");
    setSavingGstin(true);
    try {
      await saveField("gstin", next, "text");
      toast.success("GSTIN updated and re-verified");
      setEditingGstin(false);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to re-verify");
    } finally {
      setSavingGstin(false);
    }
  };

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {invoice.gstin_verified ? <ShieldCheck className="h-5 w-5 text-success" /> : <ShieldAlert className="h-5 w-5 text-warning" />}
            {invoice.seller_name ?? invoice.file_name}
          </DialogTitle>
          <DialogDescription>
            {editingGstin ? (
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={gstinDraft}
                  onChange={(e) => setGstinDraft(e.target.value.toUpperCase())}
                  maxLength={15}
                  placeholder="29ABCDE1234F1Z5"
                  className="h-8 font-mono text-xs max-w-[200px]"
                  disabled={savingGstin}
                />
                <Button size="sm" variant="default" onClick={saveAndReverify} disabled={savingGstin}>
                  {savingGstin ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                  Save & re-verify
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingGstin(false)} disabled={savingGstin}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <span className="inline-flex items-center gap-2 font-mono">
                {invoice.gstin ?? "No GSTIN"}
                <button
                  type="button"
                  onClick={() => setEditingGstin(true)}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-sans"
                  title="Edit GSTIN and re-verify"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          <div className="space-y-4">
            <EditableField
              label="Invoice number"
              value={invoice.invoice_number}
              onSave={(v) => saveField("invoice_number", v, "text")}
            />
            <EditableField
              label="Invoice date"
              value={invoice.invoice_date}
              type="date"
              onSave={(v) => saveField("invoice_date", v, "date")}
            />
            <EditableField
              label="Seller name"
              value={invoice.seller_name}
              onSave={(v) => saveField("seller_name", v, "text")}
            />
            <EditableField
              label="Buyer name"
              value={invoice.buyer_name}
              onSave={(v) => saveField("buyer_name", v, "text")}
            />
            <EditableField
              label="Taxable amount"
              value={invoice.taxable_amount != null ? String(invoice.taxable_amount) : null}
              type="number"
              prefix="₹"
              mono
              onSave={(v) => saveField("taxable_amount", v, "number")}
            />
            <div className="grid grid-cols-3 gap-2">
              <EditableField
                label="CGST"
                value={invoice.cgst != null ? String(invoice.cgst) : null}
                type="number"
                prefix="₹"
                mono
                small
                onSave={(v) => saveField("cgst", v, "number")}
              />
              <EditableField
                label="SGST"
                value={invoice.sgst != null ? String(invoice.sgst) : null}
                type="number"
                prefix="₹"
                mono
                small
                onSave={(v) => saveField("sgst", v, "number")}
              />
              <EditableField
                label="IGST"
                value={invoice.igst != null ? String(invoice.igst) : null}
                type="number"
                prefix="₹"
                mono
                small
                onSave={(v) => saveField("igst", v, "number")}
              />
            </div>
            <EditableField
              label="Total"
              value={invoice.total_amount != null ? String(invoice.total_amount) : null}
              type="number"
              prefix="₹"
              mono
              onSave={(v) => saveField("total_amount", v, "number")}
            />

            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground tracking-wider mb-2">GSTIN Verification</p>
              <p className="text-sm">{invoice.gstin_legal_name ?? "—"}</p>
              {invoice.gstin_trade_name && <p className="text-xs text-muted-foreground">Trade: {invoice.gstin_trade_name}</p>}
              <div className="flex gap-2 mt-2 flex-wrap">
                {invoice.gstin_status && <Badge variant="outline">{invoice.gstin_status}</Badge>}
                <SourceBadge source={invoice.gstin_source} verified={invoice.gstin_verified} />
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
              isPdf ? (
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

// Renders a friendly label for the GSTIN verification source. Never shows "via none".
function SourceBadge({ source, verified }: { source: string | null; verified: boolean | null }) {
  if (!source) {
    return verified
      ? <Badge variant="outline" className="text-xs border-success/30 text-success">Verified</Badge>
      : <Badge variant="outline" className="text-xs">Not verified</Badge>;
  }
  const map: Record<string, { label: string; className: string }> = {
    cache: { label: "via cache", className: "border-success/30 text-success" },
    api: { label: "via GST API", className: "border-success/30 text-success" },
    fallback: { label: "via fallback DB", className: "border-warning/30 text-warning" },
    failed: { label: "Verification failed", className: "border-destructive/30 text-destructive" },
    unverified: { label: "Not in registry", className: "border-warning/30 text-warning" },
    invalid_format: { label: "Invalid GSTIN format", className: "border-destructive/30 text-destructive" },
    missing: { label: "GSTIN missing", className: "border-destructive/30 text-destructive" },
    none: { label: verified ? "Verified" : "Not verified", className: "" }, // legacy data safeguard
  };
  const cfg = map[source] ?? { label: source, className: "" };
  return <Badge variant="outline" className={`text-xs ${cfg.className}`}>{cfg.label}</Badge>;
}

function Field({ label, value, mono, small }: { label: string; value: string | null; mono?: boolean; small?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground tracking-wider">{label}</p>
      <p className={`${mono ? "font-mono" : ""} ${small ? "text-sm" : "text-base"} font-medium mt-0.5`}>{value ?? "—"}</p>
    </div>
  );
}

// ---------- Validation breakdown ----------

// Human-readable explanations + fix tips for known issue keywords.
// Used when a legacy record only has a flat string instead of structured data.
const ISSUE_HINTS: Array<{
  match: RegExp;
  severity: "error" | "warning";
  field: string;
  message: string;
  suggestion: string;
}> = [
  {
    match: /invalid gstin|gstin.*invalid|gstin format/i,
    severity: "error",
    field: "GSTIN",
    message:
      "The GSTIN on this invoice does not match the official 15-character format (2 digits state code + 10-char PAN + entity digit + 'Z' + check digit). Invoices with malformed GSTINs are rejected by the GST portal and ITC cannot be claimed.",
    suggestion: "Re-check the GSTIN with the seller. Example of a valid format: 29ABCDE1234F1Z5.",
  },
  {
    match: /missing gstin|no gstin/i,
    severity: "error",
    field: "GSTIN",
    message:
      "No GSTIN was detected on this invoice. A GSTIN is mandatory on every B2B tax invoice — without it, the invoice is not GST-compliant and you cannot claim Input Tax Credit.",
    suggestion: "Request a corrected invoice from the seller that includes their 15-character GSTIN.",
  },
  {
    match: /gstin.*(cancelled|inactive|suspended)|status.*cancelled/i,
    severity: "error",
    field: "GSTIN",
    message:
      "The GSTIN exists in the GST registry but is no longer Active. Invoices issued under a Cancelled or Suspended GSTIN are not valid for ITC and may invite scrutiny.",
    suggestion: "Confirm with the seller — they may have a new GSTIN, or the invoice should not have been issued.",
  },
  {
    match: /gstin.*(not verified|could not be verified|unverified)/i,
    severity: "warning",
    field: "GSTIN",
    message:
      "We could not confirm this GSTIN against the live GST registry. The format looks correct, but the registry lookup failed or returned no record. The GSTIN may be very recently issued, or the lookup service was unreachable.",
    suggestion: "Re-run verification in a few minutes, or confirm the GSTIN directly with the seller.",
  },
  {
    match: /missing invoice number|no invoice number/i,
    severity: "error",
    field: "Invoice Number",
    message:
      "Every tax invoice must carry a unique sequential invoice number (Rule 46 of CGST Rules). Without one, the document is not a valid tax invoice.",
    suggestion: "Ask the seller to re-issue the invoice with a proper invoice number.",
  },
  {
    match: /missing invoice date|no invoice date/i,
    severity: "error",
    field: "Invoice Date",
    message:
      "The invoice date is missing. The date of issue determines the tax period and the time limit for claiming ITC, so it is mandatory.",
    suggestion: "Request a corrected invoice that clearly shows the date of issue.",
  },
  {
    match: /missing total|no total amount/i,
    severity: "error",
    field: "Total Amount",
    message:
      "The final payable total is missing from the invoice. Without a total, the document cannot be reconciled or filed.",
    suggestion: "Verify with the seller and request a corrected invoice with a clear total.",
  },
  {
    match: /tax calculation|tax mismatch|incorrect tax/i,
    severity: "error",
    field: "Tax Calculation",
    message:
      "Taxable value + CGST + SGST + IGST does not add up to the stated total amount. This usually points to a data entry mistake or an incorrect tax rate applied on the invoice.",
    suggestion: "Re-verify each line item, the applied tax rate, and the taxable value.",
  },
  {
    match: /both cgst.*igst|cgst.*and.*igst/i,
    severity: "error",
    field: "Tax Type",
    message:
      "An invoice should charge either CGST + SGST (intra-state supply) OR IGST (inter-state supply) — never both. This indicates an incorrect place-of-supply determination.",
    suggestion: "Identify the correct place of supply and request a corrected invoice with only the right tax type.",
  },
  {
    match: /seller name|name mismatch/i,
    severity: "warning",
    field: "Seller Name",
    message:
      "The seller name printed on the invoice does not closely match the legal/trade name registered against this GSTIN in the GST database. This can be a data-entry difference, but it can also indicate an impersonation attempt.",
    suggestion: "Confirm the seller's identity and that the GSTIN truly belongs to them.",
  },
  {
    match: /missing buyer|no buyer/i,
    severity: "warning",
    field: "Buyer Name",
    message:
      "Buyer details were not detected on the invoice. Buyer name and GSTIN are required for the recipient to claim Input Tax Credit.",
    suggestion: "Verify that the buyer block is present and legible on the original invoice.",
  },
  {
    match: /old invoice|date.*old/i,
    severity: "warning",
    field: "Invoice Date",
    message:
      "This invoice is more than a year old. ITC under GST has time limits (generally up to 30th November of the following financial year), so very old invoices may no longer be claimable.",
    suggestion: "Confirm the date is correct and check whether the ITC eligibility window has passed.",
  },
  {
    match: /duplicate/i,
    severity: "error",
    field: "Duplicate",
    message:
      "An invoice with the same content (or the same invoice number for the same seller) already exists in your account. Claiming ITC twice on the same invoice is not allowed and is a common audit trigger.",
    suggestion: "Open both records side-by-side and delete the duplicate after confirming.",
  },
  {
    match: /unusual.*tax|abnormal.*tax|tax rate/i,
    severity: "warning",
    field: "Tax Rate",
    message:
      "The effective tax rate on this invoice falls well outside typical GST slabs (5%, 12%, 18%, 28%). This can indicate a wrong rate, missing tax components, or a fabricated invoice.",
    suggestion: "Confirm the HSN/SAC codes and the GST rate that applies to this supply.",
  },
];

function explainFlatIssue(raw: string): ValidationItem {
  // Try "Field: Issue" pattern first.
  const colon = raw.indexOf(":");
  let field = "General";
  let issue = raw.trim();
  if (colon > 0 && colon < 40) {
    field = raw.slice(0, colon).trim();
    issue = raw.slice(colon + 1).trim();
  }

  const hint = ISSUE_HINTS.find((h) => h.match.test(raw));
  if (hint) {
    return {
      severity: hint.severity,
      field: hint.field,
      issue: issue || hint.field,
      message: hint.message,
      suggestion: hint.suggestion,
    };
  }

  // Unknown issue — still surface the raw text but mark it clearly.
  return {
    severity: "warning",
    field,
    issue,
    message: `${issue}. We don't have a detailed explanation for this specific check — re-process the invoice to get the latest validation details.`,
    suggestion: "Re-upload or re-validate the invoice to refresh the analysis.",
  };
}

function normalizeItems(raw: Invoice["issues"]): ValidationItem[] {
  if (!raw || raw.length === 0) return [];
  return raw.map((it) => {
    if (typeof it === "string") return explainFlatIssue(it);
    // Structured item — backfill a generic message if upstream omitted it.
    if (!it.message || it.message === it.issue) {
      const hint = ISSUE_HINTS.find((h) => h.match.test(`${it.field} ${it.issue}`));
      if (hint) {
        return {
          ...it,
          message: it.message && it.message !== it.issue ? it.message : hint.message,
          suggestion: it.suggestion ?? hint.suggestion,
        };
      }
    }
    return it;
  });
}

function StatusBadgeWithCounts({
  status,
  issues,
}: {
  status: Invoice["status"];
  issues: Invoice["issues"];
}) {
  const items = normalizeItems(issues);
  const errors = items.filter((i) => i.severity === "error").length;
  const warnings = items.filter((i) => i.severity === "warning").length;

  const tip =
    status === "valid"
      ? "All checks passed"
      : [
          errors > 0 ? `${errors} error${errors > 1 ? "s" : ""}` : null,
          warnings > 0 ? `${warnings} warning${warnings > 1 ? "s" : ""}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || `Status: ${status}`;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-1.5 cursor-default">
            <StatusBadge status={status} />
            {(errors > 0 || warnings > 0) && (
              <span className="text-[10px] font-mono text-muted-foreground">
                {errors > 0 && <span className="text-destructive">{errors}E</span>}
                {errors > 0 && warnings > 0 && " "}
                {warnings > 0 && <span className="text-warning">{warnings}W</span>}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ValidationBreakdown({
  items: rawItems,
  suggestions,
}: {
  items: Invoice["issues"];
  suggestions: Invoice["suggestions"];
}) {
  const items = normalizeItems(rawItems);
  const errors = items.filter((i) => i.severity === "error");
  const warnings = items.filter((i) => i.severity === "warning");

  if (errors.length === 0 && warnings.length === 0 && (!suggestions || suggestions.length === 0)) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 p-3 flex items-start gap-2">
        <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-success">All checks passed</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            No errors or warnings detected on this invoice.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {errors.length > 0 && (
        <Section title={`Errors (${errors.length})`} icon={<XCircle className="h-4 w-4" />} tone="error">
          {errors.map((it, idx) => <ItemCard key={`e${idx}`} item={it} tone="error" />)}
        </Section>
      )}
      {warnings.length > 0 && (
        <Section title={`Warnings (${warnings.length})`} icon={<AlertTriangle className="h-4 w-4" />} tone="warning">
          {warnings.map((it, idx) => <ItemCard key={`w${idx}`} item={it} tone="warning" />)}
        </Section>
      )}
      {suggestions && suggestions.length > 0 && (
        <Section title={`Fix suggestions (${suggestions.length})`} icon={<Lightbulb className="h-4 w-4" />} tone="info">
          <ul className="space-y-1.5 text-sm pl-1">
            {suggestions.map((s, idx) => (
              <li key={idx} className="flex gap-2 text-foreground/90">
                <span className="text-primary">→</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "error" | "warning" | "info";
  children: React.ReactNode;
}) {
  const toneMap = {
    error: "border-destructive/30 bg-destructive/5 text-destructive",
    warning: "border-warning/30 bg-warning/5 text-warning",
    info: "border-primary/30 bg-primary/5 text-primary",
  };
  return (
    <div className={`rounded-lg border p-3 ${toneMap[tone]}`}>
      <div className="flex items-center gap-2 mb-2 font-semibold text-sm">
        {icon}
        <span>{title}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ItemCard({ item, tone }: { item: ValidationItem; tone: "error" | "warning" }) {
  const dot = tone === "error" ? "bg-destructive" : "bg-warning";
  return (
    <div className="rounded-md bg-background/60 border border-border/50 p-2.5">
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">{item.field}</p>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{item.issue}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.message}</p>
          {item.suggestion && (
            <div className="mt-1.5 flex items-start gap-1.5 text-xs">
              <Lightbulb className="h-3 w-3 text-primary flex-shrink-0 mt-0.5" />
              <span className="text-foreground/80">{item.suggestion}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
