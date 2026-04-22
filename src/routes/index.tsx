import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  ScanText,
  AlertTriangle,
  BarChart3,
  Lock,
  Zap,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const features = [
  {
    icon: ScanText,
    title: "AI Invoice OCR",
    body: "Extract GSTIN, invoice number, dates, parties, and tax breakdowns from PDFs and images with vision AI — Tesseract fallback included.",
  },
  {
    icon: ShieldCheck,
    title: "Real-time GSTIN Verification",
    body: "Verify GSTINs against the live GST registry with cached lookups and an offline fallback database for uninterrupted compliance.",
  },
  {
    icon: AlertTriangle,
    title: "Fraud Detection Engine",
    body: "Catch name mismatches, inactive GSTINs, duplicate invoices, and abnormal tax values with rule-based risk scoring.",
  },
  {
    icon: BarChart3,
    title: "Compliance Dashboard",
    body: "Track compliance scores, fraud risk, and validation history with charts designed for audit readiness.",
  },
  {
    icon: Lock,
    title: "Enterprise-grade Security",
    body: "Row-level security, role-based access, encrypted storage, and server-side API keys — your financial data stays yours.",
  },
  {
    icon: Zap,
    title: "Bulk Upload & Export",
    body: "Process hundreds of invoices at once and export audit-ready PDF reports for your CA or GST filing.",
  },
];

const stats = [
  { value: "99.2%", label: "OCR accuracy" },
  { value: "<3s", label: "Per invoice" },
  { value: "100%", label: "Server-side keys" },
];

function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 backdrop-blur-xl bg-background/70">
        <div className="container mx-auto flex h-16 items-center justify-between px-6">
          <Logo />
          <div className="flex items-center gap-3">
            {user ? (
              <Link to="/dashboard">
                <Button size="sm">
                  Dashboard <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/auth">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link to="/auth" search={{ mode: "signup" }}>
                  <Button size="sm">Get started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-hero">
        <div className="absolute inset-0 grid-pattern opacity-40" />
        <div className="container relative mx-auto px-6 py-24 md:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              Built for Indian MSMEs
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-balance">
              GST compliance, on{" "}
              <span className="bg-gradient-primary bg-clip-text text-transparent">autopilot.</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-muted-foreground text-balance">
              Upload an invoice. Our AI extracts every field, verifies the GSTIN with the live GST
              registry, scores compliance, and flags fraud — in seconds.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link to={user ? "/dashboard" : "/auth"} search={user ? undefined : { mode: "signup" }}>
                <Button size="lg" className="shadow-glow">
                  {user ? "Open dashboard" : "Start free"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="#features">
                <Button size="lg" variant="outline">
                  See how it works
                </Button>
              </a>
            </div>

            <div className="mt-14 grid grid-cols-3 gap-6 max-w-xl mx-auto">
              {stats.map((s) => (
                <div key={s.label} className="text-center">
                  <div className="font-mono text-2xl md:text-3xl font-bold text-primary">
                    {s.value}
                  </div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container mx-auto px-6 py-24">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Every check, every invoice, every time.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Replace error-prone manual review with a system designed for the Indian GST regime.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-border bg-gradient-card p-6 shadow-card hover:shadow-elevated hover:border-primary/40 transition-all"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-lg">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust strip */}
      <section className="container mx-auto px-6 pb-24">
        <div className="rounded-3xl border border-border bg-gradient-card p-8 md:p-12 shadow-elevated">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold">Security is the foundation.</h2>
              <p className="mt-3 text-muted-foreground">
                Your invoices contain financial DNA. We treat them that way.
              </p>
            </div>
            <ul className="space-y-3">
              {[
                "API keys never exposed to the browser",
                "Row-level security on every database table",
                "Role-based access (admin / user) with zero-trust defaults",
                "Encrypted private storage for every uploaded file",
                "Full audit log of every API call and access",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="container mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Invoice IQ. Built for fearless compliance.
          </p>
        </div>
      </footer>
    </div>
  );
}
