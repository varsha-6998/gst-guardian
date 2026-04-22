import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Upload, FileText, ShieldCheck, AlertTriangle, ArrowRight, Sparkles, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend,
} from "recharts";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Invoice IQ" }] }),
  component: DashboardPage,
});

interface InvoiceRow {
  id: string;
  status: "processing" | "valid" | "warning" | "error";
  fraud_risk: "low" | "medium" | "high" | null;
  compliance_score: number | null;
  total_amount: number | null;
  seller_name: string | null;
  invoice_number: string | null;
  created_at: string;
}

function DashboardPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const fetchRows = async () => {
      const { data } = await supabase
        .from("invoices")
        .select("id, status, fraud_risk, compliance_score, total_amount, seller_name, invoice_number, created_at")
        .order("created_at", { ascending: false });
      setRows((data ?? []) as InvoiceRow[]);
    };
    fetchRows();
    const channel = supabase
      .channel("invoices-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoices", filter: `user_id=eq.${user.id}` },
        () => fetchRows(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const name = user?.user_metadata?.display_name ?? user?.email?.split("@")[0] ?? "there";

  if (rows === null) {
    return (
      <AppShell>
        <div className="p-6 md:p-10 max-w-6xl space-y-6">
          <Skeleton className="h-10 w-72" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-72 md:col-span-2 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        </div>
      </AppShell>
    );
  }

  const total = rows.length;
  const valid = rows.filter((r) => r.status === "valid").length;
  const warnings = rows.filter((r) => r.status === "warning").length;
  const errors = rows.filter((r) => r.status === "error").length;
  const avgCompliance = total
    ? Math.round(rows.reduce((s, r) => s + (r.compliance_score ?? 0), 0) / total)
    : 0;
  const totalValue = rows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

  // Status pie data
  const statusData = [
    { name: "Valid", value: valid, color: "var(--success)" },
    { name: "Warning", value: warnings, color: "var(--warning)" },
    { name: "Error", value: errors, color: "var(--destructive)" },
  ].filter((d) => d.value > 0);

  // Last 7 days bar
  const days: { date: string; label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, label: d.toLocaleDateString("en-IN", { weekday: "short" }), count: 0 });
  }
  rows.forEach((r) => {
    const iso = r.created_at.slice(0, 10);
    const d = days.find((x) => x.date === iso);
    if (d) d.count++;
  });

  return (
    <AppShell>
      <div className="p-6 md:p-10 max-w-6xl">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome back, <span className="text-primary">{name}</span>
            </h1>
            <p className="text-muted-foreground mt-1">Your GST compliance command center.</p>
          </div>
          <Link to="/upload">
            <Button size="lg" className="shadow-glow">
              <Upload className="h-4 w-4 mr-2" /> Upload invoice
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total invoices" value={total.toString()} icon={FileText} tone="text-foreground" />
          <StatCard label="Compliant" value={valid.toString()} icon={ShieldCheck} tone="text-success" />
          <StatCard label="Warnings" value={warnings.toString()} icon={AlertTriangle} tone="text-warning" />
          <StatCard label="High risk" value={errors.toString()} icon={AlertTriangle} tone="text-destructive" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card md:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Last 7 days — invoices uploaded</h3>
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={days}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
                    cursor={{ fill: "var(--muted)" }}
                  />
                  <Bar dataKey="count" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
            <h3 className="font-semibold mb-4">Compliance breakdown</h3>
            {statusData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">No data yet</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={3}>
                      {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Avg compliance score</p>
            <p className="font-mono text-4xl font-bold mt-2 text-primary">{avgCompliance}<span className="text-base text-muted-foreground">/100</span></p>
          </div>
          <div className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Total invoice value</p>
            <p className="font-mono text-4xl font-bold mt-2">₹{totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
          </div>
        </div>

        {total === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-gradient-card p-10 md:p-16 text-center shadow-card">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-5">
              <Sparkles className="h-7 w-7" />
            </div>
            <h2 className="text-2xl font-bold">No invoices yet</h2>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              Upload your first invoice to see AI extraction, GSTIN verification, compliance scoring, and fraud detection in action.
            </p>
            <Link to="/upload">
              <Button size="lg" className="mt-6">
                Upload your first invoice <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="font-semibold">Recent invoices</h3>
              <Link to="/invoices" className="text-sm text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border">
              {rows.slice(0, 5).map((r) => (
                <div key={r.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{r.seller_name ?? "Unknown seller"}</p>
                    <p className="text-xs text-muted-foreground font-mono">{r.invoice_number ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-sm">₹{Number(r.total_amount ?? 0).toLocaleString("en-IN")}</span>
                    <StatusBadge status={r.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>
      <p className="font-mono text-3xl font-bold mt-3">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: InvoiceRow["status"] }) {
  const map: Record<string, string> = {
    valid: "bg-success/15 text-success border-success/30",
    warning: "bg-warning/15 text-warning border-warning/30",
    error: "bg-destructive/15 text-destructive border-destructive/30",
    processing: "bg-muted text-muted-foreground border-border",
  };
  return <Badge variant="outline" className={map[status]}>{status}</Badge>;
}
