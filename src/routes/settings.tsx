import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Invoice IQ" }] }),
  component: () => (
    <AppShell>
      <div className="p-6 md:p-10">
        <div className="rounded-3xl border border-border bg-gradient-card p-12 text-center shadow-card max-w-xl mx-auto">
          <Construction className="h-10 w-10 text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground mt-2">
            Profile, company details, and notification preferences arrive in the next phase.
          </p>
        </div>
      </div>
    </AppShell>
  ),
});
