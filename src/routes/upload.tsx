import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/upload")({
  head: () => ({ meta: [{ title: "Upload — Invoice IQ" }] }),
  component: () => (
    <AppShell>
      <ComingSoon title="Invoice Upload" />
    </AppShell>
  ),
});

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="p-6 md:p-10">
      <div className="rounded-3xl border border-border bg-gradient-card p-12 text-center shadow-card max-w-xl mx-auto">
        <Construction className="h-10 w-10 text-primary mx-auto mb-4" />
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground mt-2">
          Coming in the next build phase: drag-and-drop upload, AI OCR extraction, GSTIN
          verification, and live fraud scoring.
        </p>
      </div>
    </div>
  );
}
