import { Outlet } from "react-router-dom";
import { AppSidebar } from "@/components/app/AppSidebar";
import { AppHeader } from "@/components/app/AppHeader";
import { LiveScanIndicator } from "@/components/app/LiveScanIndicator";
import { LiveScanPopup } from "@/components/app/LiveScanPopup";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";
import { cn } from "@/lib/utils";

function AppLayoutContent() {
  const { collapsed } = useSidebar();
  
  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Fixed Sidebar */}
      <div className="fixed inset-y-0 left-0 z-40">
        <AppSidebar />
      </div>
      
      {/* Main Content with dynamic left margin */}
      <div 
        className={cn(
          "flex-1 flex flex-col min-w-0 transition-all duration-300",
          collapsed ? "ml-[72px]" : "ml-[260px]"
        )}
      >
        <AppHeader />
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
      
      {/* Live Scan Indicators */}
      <LiveScanIndicator />
      <LiveScanPopup />
    </div>
  );
}

export function AppLayout() {
  return (
    <SidebarProvider>
      <AppLayoutContent />
    </SidebarProvider>
  );
}