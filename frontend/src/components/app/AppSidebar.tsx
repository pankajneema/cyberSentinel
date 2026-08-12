import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Radar,
  Bug,
  Grid3X3,
  Store,
  FileText,
  Settings,
  ChevronLeft,
  Shield,
  ShieldCheck,
  LogOut,
  Server,
  HelpCircle,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebar } from "@/contexts/SidebarContext";
import { useAuth } from "@/contexts/AuthContext";
import { LogoMark } from "@/components/Logo";
import { toast } from "@/hooks/use-toast";
import { useEffect, useMemo, useState } from "react";
import { useMe } from "@/hooks/useMe";
import { getCurrentPlan } from "@/lib/services/billing";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/app/dashboard" },
  { icon: Users, label: "Team Management", href: "/app/team" },
  { icon: Server, label: "Asset Inventory", href: "/app/assets" },
  { icon: Radar, label: "ASM", href: "/app/asm" },
  { icon: Bug, label: "Vulnerability Scans", href: "/app/vs" },
  { icon: ShieldCheck, label: "Compliance", href: "/app/compliance", badge: "New" },
  { icon: Grid3X3, label: "Services", href: "/app/services" },
  { icon: Store, label: "Marketplace", href: "/app/marketplace" },
  { icon: FileText, label: "Reports", href: "/app/reports" },
];

const bottomNavItems = [
  { icon: Settings, label: "Account", href: "/app/account" },
  { icon: HelpCircle, label: "Help & Support", href: "#" },
];

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const { me } = useMe();
  const { signOut } = useAuth();
  const [plan, setPlan] = useState<string>("Starter");

  // Real identity from the verified session.
  const profile = useMemo(
    () =>
      me
        ? { full_name: me.full_name || me.email, email: me.email, role: me.role }
        : null,
    [me]
  );

  const initials = useMemo(() => {
    if (profile?.full_name) {
      return profile.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
    }
    if (profile?.email) return profile.email[0].toUpperCase();
    return "U";
  }, [profile]);

  // Route changes (including clicking a nav link) should always close the
  // mobile drawer — otherwise it stays open covering the page you just navigated to.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  const NavLink = ({ item, isActive }: { item: typeof navItems[0]; isActive: boolean }) => {
    const Icon = item.icon;
    const content = (
      <Link
        to={item.href}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "sidebar-nav-item group relative",
          isActive
            ? "active"
            : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
        )}
      >
        <Icon className={cn("w-5 h-5 shrink-0 transition-transform group-hover:scale-110", isActive && "text-sidebar-primary-foreground")} />
        {!collapsed && (
          <>
            <span className="font-medium flex-1 truncate">{item.label}</span>
            {item.badge && (
              <span className="badge-live">
                <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />
                {item.badge}
              </span>
            )}
          </>
        )}
      </Link>
    );

    if (collapsed) {
      return (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              {item.label}
              {item.badge && <span className="badge-live text-[10px]">{item.badge}</span>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return content;
  };

  const role = profile?.role || "reader";
  const isSuperadmin = profile?.is_superadmin;

  const filteredNavItems = navItems.filter((item) => {
    if ((role === "analyst" || role === "reader") && (item.label === "Marketplace" || item.label === "Services")) {
      return false;
    }
    return true;
  });

  return (
    <>
      {/* Mobile backdrop — tapping it dismisses the drawer, same as any nav click */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "h-screen sidebar-dark flex flex-col transition-all duration-300 ease-out relative overflow-hidden",
          "fixed inset-y-0 left-0 z-50 w-[260px]",
          "md:z-10",
          collapsed ? "md:w-[72px]" : "md:w-[260px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
      {/* Decorative gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />

      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 relative z-10">
        <Link to="/app/dashboard" className="flex items-center gap-3 group" onClick={() => setMobileOpen(false)}>
          <LogoMark className="w-9 h-9 shrink-0" />
          {!collapsed && (
            <span className="font-heading font-bold text-lg text-sidebar-foreground tracking-tight">
              CyberSentinel
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1.5 rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Toggle Button — desktop-only; collapsing doesn't apply to the mobile drawer */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleCollapsed}
        className={cn(
          "hidden md:inline-flex absolute top-4 -right-3 w-6 h-6 rounded-full bg-card border border-border shadow-md hover:bg-muted z-20 transition-transform",
          collapsed && "rotate-180"
        )}
      >
        <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
      </Button>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto relative z-10 scrollbar-thin">
        <div className={cn("text-[11px] font-semibold uppercase tracking-wider mb-3 px-3", collapsed ? "text-center" : "", "text-sidebar-foreground/40")}>
          {!collapsed && "Main Menu"}
        </div>
        {filteredNavItems.map((item) => {
          const isActive = location.pathname === item.href || (item.href !== "/app/dashboard" && location.pathname.startsWith(item.href));
          return <NavLink key={item.href} item={item} isActive={isActive} />;
        })}
      </nav>

      {/* Bottom Section */}
      <div className="px-3 pb-4 space-y-1 border-t border-sidebar-border pt-4 relative z-10">
        {bottomNavItems.map((item) => {
          const isActive = location.pathname === item.href;
          return <NavLink key={item.href} item={item} isActive={isActive} />;
        })}
        
        <button
          type="button"
          onClick={async () => {
            try {
              await signOut();
            } catch (error) {
              toast({ title: "Sign out failed", description: "Please try again." });
            } finally {
              navigate("/login");
            }
          }}
          className="sidebar-nav-item text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 mt-2 w-full text-left"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span className="font-medium">Sign out</span>}
        </button>
      </div>

      {/* User info at bottom */}
      {!collapsed && (
        <div className="px-4 pb-4 relative z-10">
          <div className="p-3 rounded-xl bg-sidebar-accent/50 border border-sidebar-border/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <span className="text-xs font-semibold text-primary">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">{profile?.full_name || "User"}</p>
                <p className="text-xs text-sidebar-foreground/50 truncate">
                  {isSuperadmin ? "Super Admin" : (role ? role[0].toUpperCase() + role.slice(1) : "Reader")}
                </p>
                {isSuperadmin && (
                  <p className="text-xs text-sidebar-foreground/50 truncate">{plan}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      </aside>
    </>
  );
}
