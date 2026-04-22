import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/invoices")({
  head: () => ({ meta: [{ title: "Invoices — Invoice IQ" }] }),
  component: () => (
    <AppShell>
      <div className="p-6 md:p-10">
        <div className="rounded-3xl border border-border bg-gradient-card p-12 text-center shadow-card max-w-xl mx-auto">
          <Construction className="h-10 w-10 text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Invoice History</h1>
          <p className="text-muted-foreground mt-2">
            Coming next: searchable, filterable list of every processed invoice with
            compliance scores and fraud risk badges.
          </p>
        </div>
      </div>
    </AppShell>
  ),
});
