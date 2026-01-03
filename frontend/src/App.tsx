import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Pricing from "./pages/Pricing";
import About from "./pages/About";
import Contact from "./pages/Contact";
import ServicesPage from "./pages/Services";
import NotFound from "./pages/NotFound";
import { AppLayout } from "./layouts/AppLayout";
import Dashboard from "./pages/app/Dashboard";
import ASM from "./pages/app/ASM";
import VS from "./pages/app/VS";
import Assets from "./pages/app/Assets";
import AppServices from "./pages/app/Services";
import Marketplace from "./pages/app/Marketplace";
import Reports from "./pages/app/Reports";
import Account from "./pages/app/Account";
import Team from "./pages/app/Team";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/services" element={<ServicesPage />} />
          
          {/* App routes */}
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="team" element={<Team />} />
            <Route path="asm" element={<ASM />} />
            <Route path="assets" element={<Assets />} />
            <Route path="vs" element={<VS />} />
            <Route path="services" element={<AppServices />} />
            <Route path="marketplace" element={<Marketplace />} />
            <Route path="reports" element={<Reports />} />
            <Route path="account" element={<Account />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
