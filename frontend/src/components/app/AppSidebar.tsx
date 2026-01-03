import { Link, useLocation } from "react-router-dom";
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
  LogOut,
  Server,
  HelpCircle,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebar } from "@/contexts/SidebarContext";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/app/dashboard" },
  { icon: Users, label: "Team Management", href: "/app/team" },
  { icon: Server, label: "Asset Inventory", href: "/app/assets" },
  { icon: Radar, label: "ASM", href: "/app/asm", badge: "Live" },
  { icon: Bug, label: "Vulnerability Scans", href: "/app/vs", badge: "Live" },
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
  const { collapsed, toggleCollapsed } = useSidebar();

  const NavLink = ({ item, isActive }: { item: typeof navItems[0]; isActive: boolean }) => {
    const Icon = item.icon;
    const content = (
      <Link
        to={item.href}
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

  return (
    <aside
      className={cn(
        "h-screen sidebar-dark flex flex-col transition-all duration-300 ease-out relative overflow-hidden",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
    >
      {/* Decorative gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />

      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 relative z-10">
        <Link to="/app/dashboard" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center shrink-0 shadow-lg group-hover:shadow-glow transition-shadow duration-300">
            <Shield className="w-5 h-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="font-heading font-bold text-lg text-sidebar-foreground tracking-tight">
              CyberSentinel
            </span>
          )}
        </Link>
      </div>

      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleCollapsed}
        className={cn(
          "absolute top-4 -right-3 w-6 h-6 rounded-full bg-card border border-border shadow-md hover:bg-muted z-20 transition-transform",
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
        {navItems.map((item) => {
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
        
        <Link
          to="/"
          className="sidebar-nav-item text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 mt-2"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span className="font-medium">Sign out</span>}
        </Link>
      </div>

      {/* User info at bottom */}
      {!collapsed && (
        <div className="px-4 pb-4 relative z-10">
          <div className="p-3 rounded-xl bg-sidebar-accent/50 border border-sidebar-border/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <span className="text-xs font-semibold text-primary">JS</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">John Smith</p>
                <p className="text-xs text-sidebar-foreground/50 truncate">Pro Plan</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}