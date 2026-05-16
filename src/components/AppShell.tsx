import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Logo } from "./Logo";
import { Button } from "./ui/button";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard,
  Upload,
  FileText,
  ShieldCheck,
  Settings,
  LogOut,
  Loader2,
  Building2,
} from "lucide-react";

const baseNav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/upload", label: "Upload", icon: Upload },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/vendors", label: "Vendors", icon: Building2 },
];

const adminNav = [{ to: "/admin", label: "Admin", icon: ShieldCheck }];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, role, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth" });
    }
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const nav = role === "admin" ? [...baseNav, ...adminNav] : baseNav;

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="p-5 border-b border-sidebar-border">
          <Logo />
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((item) => {
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-1">
          <Link
            to="/settings"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <Settings className="h-4 w-4" /> Settings
          </Link>
          <div className="px-3 py-2 mt-2">
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            <p className="text-[10px] uppercase tracking-wider text-primary mt-0.5">
              {role ?? "user"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="w-full justify-start text-muted-foreground"
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 h-14 border-b border-border bg-background/90 backdrop-blur-xl flex items-center justify-between px-4">
        <Logo size="sm" />
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Main */}
      <main className="flex-1 min-w-0 pt-14 md:pt-0">
        <div className="md:hidden border-b border-border bg-sidebar overflow-x-auto">
          <nav className="flex gap-1 p-2 min-w-max">
            {nav.map((item) => {
              const active = location.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-sidebar-accent"
                  }`}
                >
                  <item.icon className="h-3.5 w-3.5" /> {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {children}
      </main>
    </div>
  );
}
