import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Radar,
  Bug,
  Swords,
  Brain,
  ShieldAlert,
  FileCheck,
  CheckCircle2,
  Mail,
  ArrowRight,
} from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { toast } from "sonner";

const services = [
  {
    icon: Radar,
    title: "Attack Surface Management",
    description: "Continuously discover all your external & cloud assets and prioritize exposures. Get real-time visibility into your digital footprint.",
    features: ["Asset Discovery", "Exposure Monitoring", "Cloud Integration", "Risk Scoring"],
    status: "available",
    href: "/app/asm",
    color: "primary",
  },
  {
    icon: Bug,
    title: "Vulnerability Scanning",
    description: "High-fidelity vulnerability scanning with contextual prioritization and remediation guidance. Identify CVEs before attackers do.",
    features: ["Automated Scanning", "CVE Detection", "Prioritization", "Remediation Guides"],
    status: "available",
    href: "/app/vs",
    color: "accent",
  },
  {
    icon: Swords,
    title: "Breach & Attack Simulation",
    description: "Automated adversary emulation to test your defenses against real-world attack techniques mapped to MITRE ATT&CK.",
    features: ["Red Team Automation", "MITRE ATT&CK", "Defense Testing", "Gap Analysis"],
    status: "coming-soon",
    color: "secondary",
  },
  {
    icon: Brain,
    title: "Threat Intelligence",
    description: "Aggregated threat feeds with predictive analytics and contextual enrichment. Stay ahead of emerging threats.",
    features: ["Threat Feeds", "Predictive Analytics", "IOC Enrichment", "Dark Web Monitoring"],
    status: "coming-soon",
    color: "warning",
  },
  {
    icon: ShieldAlert,
    title: "Incident Response",
    description: "Orchestrated response workflows with automated playbooks and case management. Respond faster to security incidents.",
    features: ["Playbook Automation", "Case Management", "SOAR Integration", "Forensics"],
    status: "coming-soon",
    color: "destructive",
  },
  {
    icon: FileCheck,
    title: "Compliance & Audit",
    description: "Continuous compliance monitoring for SOC2, GDPR, HIPAA, and more frameworks. Automate your audit preparation.",
    features: ["Multi-Framework", "Gap Analysis", "Evidence Collection", "Audit Reports"],
    status: "coming-soon",
    color: "success",
  },
];

export default function Services() {
  const [email, setEmail] = useState("");

  const handleNotify = (serviceName: string) => {
    if (!email) {
      toast.error("Please enter your email address");
      return;
    }
    toast.success(`You'll be notified when ${serviceName} launches!`);
    setEmail("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Security Services</h1>
        <p className="text-muted-foreground">
          Explore our complete suite of cybersecurity capabilities
        </p>
      </div>

      {/* Services Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {services.map((service, index) => {
          const Icon = service.icon;
          const isAvailable = service.status === "available";

          return (
            <motion.div
              key={service.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`card-elevated p-6 ${isAvailable ? "border-primary/30" : ""}`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    isAvailable ? "gradient-bg" : "bg-muted"
                  }`}>
                    <Icon className={`w-6 h-6 ${isAvailable ? "text-primary-foreground" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <h3 className="font-heading font-semibold text-foreground">{service.title}</h3>
                    {isAvailable ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="w-3 h-3" />
                        Available Now
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Coming Soon</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className="text-sm text-muted-foreground mb-4">{service.description}</p>

              {/* Features */}
              <div className="flex flex-wrap gap-2 mb-6">
                {service.features.map((feature) => (
                  <span
                    key={feature}
                    className="text-xs px-2 py-1 bg-muted rounded-full text-muted-foreground"
                  >
                    {feature}
                  </span>
                ))}
              </div>

              {/* CTA */}
              {isAvailable ? (
                <Button variant="gradient" className="w-full" asChild>
                  <Link to={service.href!}>
                    Open {service.title.split(" ")[0]}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      onClick={() => handleNotify(service.title)}
                    >
                      <Mail className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Get notified when this service launches
                  </p>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
