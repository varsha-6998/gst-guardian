import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { ShieldCheck, Users, Activity, Loader2, Database } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Invoice IQ" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { role, loading } = useAuth();
  const [apiEnabled, setApiEnabled] = useState(true);
  const [stats, setStats] = useState<{ users: number; invoices: number; calls: number; failures: number } | null>(null);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [savingToggle, setSavingToggle] = useState(false);

  useEffect(() => {
    if (role !== "admin") return;
    (async () => {
      // load setting
      const { data: s } = await supabase.from("app_settings").select("value").eq("key", "gstin_api_enabled").maybeSingle();
      if (s) setApiEnabled(s.value === true || s.value === "true");

      // counts
      const [{ count: invoices }, { count: calls }, { count: failures }, { data: profiles }] = await Promise.all([
        supabase.from("invoices").select("id", { count: "exact", head: true }),
        supabase.from("api_usage_logs").select("id", { count: "exact", head: true }),
        supabase.from("api_usage_logs").select("id", { count: "exact", head: true }).eq("success", false),
        supabase.from("profiles").select("user_id"),
      ]);
      setStats({
        users: profiles?.length ?? 0,
        invoices: invoices ?? 0,
        calls: calls ?? 0,
        failures: failures ?? 0,
      });

      const { data: logs } = await supabase
        .from("api_usage_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(15);
      setRecentLogs(logs ?? []);
    })();
  }, [role]);

  if (loading) return null;
  if (role !== "admin") return <Navigate to="/dashboard" />;

  const toggleApi = async (next: boolean) => {
    setSavingToggle(true);
    const { error } = await supabase.from("app_settings").upsert({ key: "gstin_api_enabled", value: next });
    setSavingToggle(false);
    if (error) {
      toast.error(error.message);
    } else {
      setApiEnabled(next);
      toast.success(`GSTIN API ${next ? "enabled" : "disabled"}`);
    }
  };

  return (
    <AppShell>
      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <ShieldCheck className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Admin Console</h1>
        </div>

        {!stats ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <Card label="Users" value={stats.users} icon={Users} />
              <Card label="Invoices" value={stats.invoices} icon={Database} />
              <Card label="API calls" value={stats.calls} icon={Activity} />
              <Card label="Failures" value={stats.failures} icon={Activity} tone="text-destructive" />
            </div>

            <div className="rounded-2xl border border-border bg-gradient-card p-6 mb-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-lg font-semibold">GSTINCheck API</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Toggle live API verification. When disabled, the app uses the cached/fallback GSTIN database only — saves API credits.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {savingToggle && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  <Switch checked={apiEnabled} onCheckedChange={toggleApi} disabled={savingToggle} />
                  <Badge variant="outline" className={apiEnabled ? "border-success/30 text-success" : "border-muted text-muted-foreground"}>
                    {apiEnabled ? "Live API" : "Fallback only"}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="font-semibold">Recent API activity</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2">Time</th>
                      <th className="text-left px-4 py-2">API</th>
                      <th className="text-left px-4 py-2">Endpoint</th>
                      <th className="text-center px-4 py-2">Status</th>
                      <th className="text-right px-4 py-2">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center text-muted-foreground py-8">No API calls yet</td>
                      </tr>
                    ) : recentLogs.map((l) => (
                      <tr key={l.id}>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-2 font-mono text-xs">{l.api_name}</td>
                        <td className="px-4 py-2 text-xs">{l.endpoint ?? "—"}</td>
                        <td className="px-4 py-2 text-center">
                          <Badge variant="outline" className={l.success ? "border-success/30 text-success" : "border-destructive/30 text-destructive"}>
                            {l.status_code ?? (l.success ? "ok" : "fail")}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{l.latency_ms ?? "—"}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Card({ label, value, icon: Icon, tone = "text-primary" }: { label: string; value: number; icon: any; tone?: string }) {
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
