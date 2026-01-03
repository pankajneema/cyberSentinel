import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Star,
  Download,
  ExternalLink,
  Shield,
  Cloud,
  Bell,
  Lock,
  Zap,
  Users,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";

const integrations = [
  { id: 1, name: "Slack", category: "notifications", description: "Get real-time security alerts in your Slack channels", icon: "💬", installed: true, rating: 4.8, downloads: "50K+" },
  { id: 2, name: "Jira", category: "ticketing", description: "Create tickets automatically for vulnerabilities", icon: "🎫", installed: true, rating: 4.7, downloads: "45K+" },
  { id: 3, name: "Microsoft Teams", category: "notifications", description: "Security notifications in Teams channels", icon: "👥", installed: false, rating: 4.6, downloads: "35K+" },
  { id: 4, name: "ServiceNow", category: "ticketing", description: "ITSM integration for incident management", icon: "🔧", installed: false, rating: 4.5, downloads: "25K+" },
  { id: 5, name: "PagerDuty", category: "notifications", description: "Critical alert escalation and on-call management", icon: "📟", installed: false, rating: 4.9, downloads: "30K+" },
  { id: 6, name: "Splunk", category: "siem", description: "Forward findings to Splunk for correlation", icon: "📊", installed: false, rating: 4.7, downloads: "40K+" },
  { id: 7, name: "AWS Security Hub", category: "cloud", description: "Sync findings with AWS Security Hub", icon: "☁️", installed: false, rating: 4.6, downloads: "28K+" },
  { id: 8, name: "Azure Sentinel", category: "siem", description: "Integration with Microsoft Azure Sentinel", icon: "🔷", installed: false, rating: 4.5, downloads: "22K+" },
];

const expertServices = [
  { id: 1, name: "Penetration Testing", provider: "CyberSec Pro", description: "Manual penetration testing by certified experts", price: "Starting at $5,000", icon: Shield, available: true },
  { id: 2, name: "Incident Response", provider: "IR Specialists", description: "24/7 incident response and forensics", price: "On-demand", icon: Zap, available: true },
  { id: 3, name: "Security Training", provider: "SecAware Academy", description: "Employee security awareness training", price: "$15/user/month", icon: Users, available: true },
  { id: 4, name: "Compliance Consulting", provider: "Audit Ready", description: "SOC2, ISO 27001 compliance guidance", price: "Custom quote", icon: Lock, available: false },
];

export default function Marketplace() {
  const [searchQuery, setSearchQuery] = useState("");
  const [installedIntegrations, setInstalledIntegrations] = useState<number[]>([1, 2]);

  const handleInstall = (id: number, name: string) => {
    setInstalledIntegrations([...installedIntegrations, id]);
    toast({
      title: "Integration Installed",
      description: `${name} has been successfully installed.`,
    });
  };

  const handleUninstall = (id: number, name: string) => {
    setInstalledIntegrations(installedIntegrations.filter(i => i !== id));
    toast({
      title: "Integration Removed",
      description: `${name} has been uninstalled.`,
    });
  };

  const filteredIntegrations = integrations.filter(i => 
    i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Marketplace</h1>
        <p className="text-muted-foreground mt-1">Integrations and expert services to enhance your security</p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search integrations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs defaultValue="integrations">
        <TabsList>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="installed">Installed ({installedIntegrations.length})</TabsTrigger>
          <TabsTrigger value="services">Expert Services</TabsTrigger>
        </TabsList>

        <TabsContent value="integrations" className="mt-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredIntegrations.map((integration, index) => {
              const isInstalled = installedIntegrations.includes(integration.id);
              return (
                <motion.div
                  key={integration.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="card-elevated p-5 hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-3xl">{integration.icon}</span>
                    {isInstalled && (
                      <Badge variant="secondary" className="bg-success/10 text-success">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Installed
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">{integration.name}</h3>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{integration.description}</p>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4">
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3 text-warning fill-warning" />
                      {integration.rating}
                    </span>
                    <span className="flex items-center gap-1">
                      <Download className="w-3 h-3" />
                      {integration.downloads}
                    </span>
                  </div>
                  {isInstalled ? (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1">
                        Configure
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleUninstall(integration.id, integration.name)}
                      >
                        Uninstall
                      </Button>
                    </div>
                  ) : (
                    <Button 
                      variant="gradient" 
                      size="sm" 
                      className="w-full"
                      onClick={() => handleInstall(integration.id, integration.name)}
                    >
                      Install
                    </Button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="installed" className="mt-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {integrations.filter(i => installedIntegrations.includes(i.id)).map((integration, index) => (
              <motion.div
                key={integration.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                className="card-elevated p-5"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">{integration.icon}</span>
                  <div>
                    <h3 className="font-semibold text-foreground">{integration.name}</h3>
                    <span className="text-xs text-success flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
                      Connected
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1">
                    Configure
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => handleUninstall(integration.id, integration.name)}
                  >
                    Remove
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>

          {installedIntegrations.length === 0 && (
            <div className="text-center py-12">
              <Cloud className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-foreground mb-2">No integrations installed</h3>
              <p className="text-sm text-muted-foreground">Browse the marketplace to find integrations</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="services" className="mt-6">
          <div className="grid sm:grid-cols-2 gap-4">
            {expertServices.map((service, index) => (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="card-elevated p-6"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-primary/10">
                    <service.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-foreground">{service.name}</h3>
                        <p className="text-sm text-muted-foreground">by {service.provider}</p>
                      </div>
                      {!service.available && (
                        <Badge variant="outline">
                          <Clock className="w-3 h-3 mr-1" />
                          Coming Soon
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">{service.description}</p>
                    <div className="flex items-center justify-between mt-4">
                      <span className="text-sm font-medium text-primary">{service.price}</span>
                      <Button 
                        variant={service.available ? "gradient" : "outline"} 
                        size="sm"
                        disabled={!service.available}
                      >
                        {service.available ? (
                          <>
                            Request Demo
                            <ExternalLink className="w-3 h-3 ml-1" />
                          </>
                        ) : (
                          "Notify Me"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
