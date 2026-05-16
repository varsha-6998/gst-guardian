import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Search, Building2, ShieldAlert, ShieldCheck, ShieldQuestion, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/vendors")({
  head: () => ({ meta: [{ title: "Vendors — Invoice IQ" }] }),
  component: () => (
    <AppShell>
      <VendorsPage />
    </AppShell>
  ),
});

type Vendor = {
  id: string;
  gstin: string;
  legal_name: string | null;
  trade_name: string | null;
  last_seller_name: string | null;
  risk_level: "low" | "medium" | "high";
  total_invoices: number;
  flagged_count: number;
  total_amount: number | null;
  last_seen_at: string | null;
};

function VendorsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Vendor[] | null>(null);
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState<"all" | "low" | "medium" | "high">("all");

  const refresh = async () => {
    const { data } = await supabase
      .from("vendors")
      .select("*")
      .order("last_seen_at", { ascending: false, nullsFirst: false });
    setRows((data ?? []) as any);
  };

  useEffect(() => {
    if (!user) return;
    refresh();
    const ch = supabase
      .channel("vendors-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vendors", filter: `user_id=eq.${user.id}` },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((v) => {
      if (risk !== "all" && v.risk_level !== risk) return false;
      if (q) {
        const s = q.toLowerCase();
        return (
          v.gstin.toLowerCase().includes(s) ||
          v.legal_name?.toLowerCase().includes(s) ||
          v.trade_name?.toLowerCase().includes(s) ||
          v.last_seller_name?.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [rows, q, risk]);

  const counts = useMemo(() => {
    const c = { all: rows?.length ?? 0, low: 0, medium: 0, high: 0 };
    rows?.forEach((v) => {
      c[v.risk_level]++;
    });
    return c;
  }, [rows]);

  if (rows === null) {
    return (
      <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Vendors</h1>
        <p className="text-muted-foreground mt-1">
          {counts.all} vendors · {counts.high} high · {counts.medium} medium · {counts.low} low risk
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or GSTIN…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {(["all", "high", "medium", "low"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRisk(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                risk === r
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r} {r !== "all" && `(${counts[r]})`}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No vendors yet. Upload invoices to build your vendor list.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((v) => (
            <VendorCard key={v.id} vendor={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function VendorCard({ vendor }: { vendor: Vendor }) {
  const name =
    vendor.trade_name || vendor.legal_name || vendor.last_seller_name || vendor.gstin;
  const sub = vendor.legal_name && vendor.legal_name !== name ? vendor.legal_name : null;
  const flagRatio =
    vendor.total_invoices > 0
      ? Math.round((vendor.flagged_count / vendor.total_invoices) * 100)
      : 0;

  return (
    <Link
      to="/invoices"
      className="block rounded-2xl border border-border bg-card p-5 shadow-card hover:border-primary/40 hover:shadow-lg transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate">{name}</p>
          {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
          <p className="text-xs text-muted-foreground font-mono mt-1">{vendor.gstin}</p>
        </div>
        <RiskBadge risk={vendor.risk_level} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center pt-3 border-t border-border">
        <Stat label="Invoices" value={String(vendor.total_invoices)} />
        <Stat label="Flagged" value={`${vendor.flagged_count}${flagRatio > 0 ? ` · ${flagRatio}%` : ""}`} tone={vendor.flagged_count > 0 ? "danger" : undefined} />
        <Stat
          label="Total"
          value={`₹${Number(vendor.total_amount ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
        />
      </div>

      {vendor.last_seen_at && (
        <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1">
          <ExternalLink className="h-3 w-3" />
          Last seen {new Date(vendor.last_seen_at).toLocaleDateString("en-IN")}
        </p>
      )}
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div>
      <p className={`text-sm font-semibold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  if (risk === "high") {
    return (
      <Badge variant="destructive" className="gap-1 shrink-0">
        <ShieldAlert className="h-3 w-3" /> High risk
      </Badge>
    );
  }
  if (risk === "medium") {
    return (
      <Badge className="gap-1 bg-amber-500/15 text-amber-600 hover:bg-amber-500/20 border-amber-500/30 shrink-0">
        <ShieldQuestion className="h-3 w-3" /> Medium
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/30 shrink-0">
      <ShieldCheck className="h-3 w-3" /> Low
    </Badge>
  );
}
