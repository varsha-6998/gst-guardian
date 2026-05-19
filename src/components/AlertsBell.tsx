import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, AlertTriangle, ShieldAlert, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type Alert = {
  id: string;
  seller_name: string | null;
  invoice_number: string | null;
  status: string;
  fraud_risk: string | null;
  fraud_reasons: string[] | null;
  created_at: string;
};

export function AlertsBell() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("invoices")
      .select("id, seller_name, invoice_number, status, fraud_risk, fraud_reasons, created_at")
      .or("status.eq.error,status.eq.warning,fraud_risk.eq.high")
      .order("created_at", { ascending: false })
      .limit(20);
    setAlerts((data ?? []) as Alert[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel("alerts-bell")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoices", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const count = alerts.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground flex items-center justify-center">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-[480px] overflow-y-auto">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Alerts</span>
          {count > 0 && <Badge variant="secondary" className="text-[10px]">{count}</Badge>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {alerts.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <ShieldAlert className="h-6 w-6 mx-auto mb-2 opacity-50" />
            No alerts. You're all clear.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {alerts.map((a) => {
              const Icon = a.fraud_risk === "high" ? ShieldAlert : a.status === "error" ? FileWarning : AlertTriangle;
              const tone =
                a.fraud_risk === "high" || a.status === "error"
                  ? "text-destructive"
                  : "text-warning";
              const reason = a.fraud_reasons?.[0] ?? `${a.status} status`;
              return (
                <Link
                  key={a.id}
                  to="/invoices"
                  className="flex items-start gap-3 px-3 py-2.5 hover:bg-accent transition-colors"
                >
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">
                      {a.seller_name ?? "Unknown"} · {a.invoice_number ?? "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{reason}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(a.created_at).toLocaleString("en-IN", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
