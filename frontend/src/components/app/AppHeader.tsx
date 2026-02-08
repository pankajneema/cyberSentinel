import { Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { getProfile } from "@/lib/services/profile";
import { getCurrentPlan } from "@/lib/services/billing";
import { logout } from "@/lib/services/auth";
import { toast } from "@/hooks/use-toast";

export function AppHeader() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<{ full_name: string; email: string; avatar_url?: string; role?: string; is_superadmin?: boolean } | null>(null);
  const [plan, setPlan] = useState<string>("Pro Plan");

  useEffect(() => {
    const load = async () => {
      try {
        const profileRes = await getProfile();
        setProfile(profileRes);
        if (profileRes?.is_superadmin) {
          const planRes = await getCurrentPlan();
          setPlan(planRes.plan || "Pro Plan");
        }
      } catch {
        // silent fallback
      }
    };
    load();
  }, []);

  const initials = useMemo(() => {
    if (profile?.full_name) {
      return profile.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
    }
    if (profile?.email) return profile.email[0].toUpperCase();
    return "U";
  }, [profile]);

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6">
      {/* Search */}
      <div className="relative w-96 hidden md:block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search assets, scans, vulnerabilities..."
          className="pl-10 bg-muted/50 border-0 focus-visible:ring-1"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 ml-auto">
        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
        </Button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="Profile"
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full gradient-bg flex items-center justify-center text-primary-foreground text-sm font-medium">
                  {initials}
                </div>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div>{profile?.full_name || "User"}</div>
              <div className="text-sm font-normal text-muted-foreground">{profile?.email || "user@company.com"}</div>
              <div className="text-xs font-normal text-muted-foreground mt-1">
                {profile?.is_superadmin ? "Super Admin" : (profile?.role ? profile.role[0].toUpperCase() + profile.role.slice(1) : "Reader")}
              </div>
              {profile?.is_superadmin && (
                <div className="text-xs font-normal text-muted-foreground mt-1">{plan}</div>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/app/account">Account Settings</Link>
            </DropdownMenuItem>
            {profile?.is_superadmin && <DropdownMenuItem>Billing</DropdownMenuItem>}
            <DropdownMenuItem>API Keys</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await logout();
                } catch {
                  toast({ title: "Sign out failed", description: "Please try again." });
                } finally {
                  localStorage.removeItem("access_token");
                  localStorage.removeItem("user");
                  navigate("/login");
                }
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
