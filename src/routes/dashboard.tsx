import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Upload, FileText, ShieldCheck, AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Invoice IQ" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  const name = user?.user_metadata?.display_name ?? user?.email?.split("@")[0] ?? "there";

  return (
    <AppShell>
      <div className="p-6 md:p-10 max-w-6xl">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome back, <span className="text-primary">{name}</span>
            </h1>
            <p className="text-muted-foreground mt-1">
              Your GST compliance command center.
            </p>
          </div>
          <Link to="/upload">
            <Button size="lg" className="shadow-glow">
              <Upload className="h-4 w-4 mr-2" /> Upload invoice
            </Button>
          </Link>
        </div>

        {/* Stats placeholder */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total invoices", value: "0", icon: FileText, tone: "text-foreground" },
            { label: "Compliant", value: "0", icon: ShieldCheck, tone: "text-primary" },
            { label: "Warnings", value: "0", icon: AlertTriangle, tone: "text-warning" },
            { label: "High risk", value: "0", icon: AlertTriangle, tone: "text-destructive" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-border bg-gradient-card p-5 shadow-card"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </p>
                <s.icon className={`h-4 w-4 ${s.tone}`} />
              </div>
              <p className="font-mono text-3xl font-bold mt-3">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Empty state */}
        <div className="rounded-3xl border border-dashed border-border bg-gradient-card p-10 md:p-16 text-center shadow-card">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-5">
            <Sparkles className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-bold">No invoices yet</h2>
          <p className="text-muted-foreground mt-2 max-w-md mx-auto">
            Upload your first invoice to see AI-powered extraction, GSTIN verification,
            compliance scoring, and fraud risk detection in action.
          </p>
          <Link to="/upload">
            <Button size="lg" className="mt-6">
              Upload your first invoice <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
