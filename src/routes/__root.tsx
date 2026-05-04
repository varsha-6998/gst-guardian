import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground font-mono">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Invoice IQ — AI-Powered GST Compliance Assistant" },
      {
        name: "description",
        content:
          "Upload invoices, extract data with AI OCR, verify GSTINs, detect fraud, and ensure GST compliance for your MSME.",
      },
      { name: "author", content: "Invoice IQ" },
      { property: "og:title", content: "Invoice IQ — AI-Powered GST Compliance Assistant" },
      {
        property: "og:description",
        content:
          "Automate GST compliance: AI invoice OCR, GSTIN verification, fraud detection, and audit-ready reporting for MSMEs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Invoice IQ — AI-Powered GST Compliance Assistant" },
      { name: "description", content: "GST Guardian is an AI-powered web app for MSMEs to upload, process, and validate GST invoices." },
      { property: "og:description", content: "GST Guardian is an AI-powered web app for MSMEs to upload, process, and validate GST invoices." },
      { name: "twitter:description", content: "GST Guardian is an AI-powered web app for MSMEs to upload, process, and validate GST invoices." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/7532cc9a-e874-4293-9a10-fa5e61f40bb8/id-preview-a74135d1--ab845009-7d02-4be6-9081-b5126a90e024.lovable.app-1777295325077.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/7532cc9a-e874-4293-9a10-fa5e61f40bb8/id-preview-a74135d1--ab845009-7d02-4be6-9081-b5126a90e024.lovable.app-1777295325077.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <Outlet />
      <Toaster />
    </AuthProvider>
  );
}
