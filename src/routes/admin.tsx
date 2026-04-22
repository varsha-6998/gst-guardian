import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { Construction, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Invoice IQ" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { role, loading } = useAuth();
  if (loading) return null;
  if (role !== "admin") return <Navigate to="/dashboard" />;

  return (
    <AppShell>
      <div className="p-6 md:p-10">
        <div className="flex items-center gap-3 mb-6">
          <ShieldCheck className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Admin Console</h1>
        </div>
        <div className="rounded-3xl border border-border bg-gradient-card p-12 text-center shadow-card">
          <Construction className="h-10 w-10 text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">
            User management, API usage logs, fallback DB editor, and the GSTIN-API toggle land
            in the next build phase.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
