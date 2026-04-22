import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Loader2, User, Building2 } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Invoice IQ" }] }),
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});

function SettingsPage() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, company_name")
        .eq("user_id", user.id)
        .maybeSingle();
      setDisplayName(data?.display_name ?? "");
      setCompanyName(data?.company_name ?? "");
      setLoading(false);
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() || null, company_name: companyName.trim() || null })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profile updated");
  };

  return (
    <div className="p-6 md:p-10 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-1">Settings</h1>
      <p className="text-muted-foreground mb-8">Manage your profile and company details.</p>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-gradient-card p-6 space-y-5">
          <div>
            <Label className="flex items-center gap-2 mb-1.5"><User className="h-4 w-4" /> Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
          </div>
          <div>
            <Label className="flex items-center gap-2 mb-1.5"><Building2 className="h-4 w-4" /> Company name</Label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={150} />
          </div>
          <div>
            <Label className="mb-1.5">Email</Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
          <Button onClick={save} disabled={saving} className="shadow-glow">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
