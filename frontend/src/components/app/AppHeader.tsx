import { Bell, Check, CheckCheck, Search } from "lucide-react";
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { getMe } from "@/lib/services/auth";
import {
  fetchNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  markUnread,
  type Notification,
} from "@/lib/services/notifications";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function AppHeader() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<{ full_name: string; email: string; avatar_url?: string; role?: string; is_superadmin?: boolean } | null>(null);
  const [plan] = useState<string>("Starter");

  // Notifications
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);

  const refreshUnread = useCallback(async () => {
    try {
      const { count } = await getUnreadCount();
      setUnread(count);
    } catch {
      /* ignore polling errors */
    }
  }, []);

  useEffect(() => {
    refreshUnread();
    const id = setInterval(refreshUnread, 30000);
    return () => clearInterval(id);
  }, [refreshUnread]);

  const loadNotifications = useCallback(async () => {
    setLoadingNotifs(true);
    try {
      setNotifications(await fetchNotifications());
    } catch {
      /* ignore */
    } finally {
      setLoadingNotifs(false);
    }
  }, []);

  const onNotifOpenChange = (open: boolean) => {
    if (open) loadNotifications();
  };

  const toggleRead = async (n: Notification) => {
    try {
      const updated = n.is_read ? await markUnread(n.id) : await markRead(n.id);
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? updated : x)));
      refreshUnread();
    } catch {
      toast({ title: "Could not update notification" });
    }
  };

  const onNotifClick = async (n: Notification) => {
    if (!n.is_read) {
      try {
        await markRead(n.id);
        refreshUnread();
      } catch {
        /* ignore */
      }
    }
    if (n.link) navigate(n.link);
  };

  const onMarkAllRead = async () => {
    try {
      await markAllRead();
      setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
      setUnread(0);
    } catch {
      toast({ title: "Could not mark all as read" });
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        // Real identity from the verified Supabase session.
        const me = await getMe();
        setProfile({
          full_name: me.full_name || me.email,
          email: me.email,
          avatar_url: me.avatar_url || undefined,
          role: me.role,
        });
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
        <DropdownMenu onOpenChange={onNotifOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 flex items-center justify-center text-[10px] font-semibold bg-destructive text-destructive-foreground rounded-full">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <div className="flex items-center justify-between px-2 py-1.5">
              <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
              {notifications.some((n) => !n.is_read) && (
                <button
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  onClick={(e) => {
                    e.preventDefault();
                    onMarkAllRead();
                  }}
                >
                  <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                </button>
              )}
            </div>
            <DropdownMenuSeparator />
            <div className="max-h-80 overflow-y-auto">
              {loadingNotifs ? (
                <div className="px-3 py-6 text-sm text-muted-foreground text-center">Loading…</div>
              ) : notifications.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted-foreground text-center">
                  You're all caught up
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`flex items-start gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer ${
                      n.is_read ? "" : "bg-muted/30"
                    }`}
                    onClick={() => onNotifClick(n)}
                  >
                    {!n.is_read && <span className="mt-1.5 w-2 h-2 rounded-full bg-destructive shrink-0" />}
                    <div className={`flex-1 min-w-0 ${n.is_read ? "pl-4" : ""}`}>
                      <div className="text-sm font-medium truncate">{n.title}</div>
                      {n.body && (
                        <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</div>
                    </div>
                    <button
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      title={n.is_read ? "Mark as unread" : "Mark as read"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRead(n);
                      }}
                    >
                      <Check className={`w-4 h-4 ${n.is_read ? "opacity-40" : ""}`} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

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
            {profile?.is_superadmin && (
              <DropdownMenuItem asChild>
                <Link to="/app/account?tab=billing">Billing</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await supabase.auth.signOut();
                } catch {
                  toast({ title: "Sign out failed", description: "Please try again." });
                } finally {
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
