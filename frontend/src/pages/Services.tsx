import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { 
  Radar, 
  Bug, 
  Swords, 
  Brain, 
  ShieldAlert, 
  FileCheck,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Shield,
  Zap,
  Lock,
  Globe,
  Server,
  Cloud,
  Target,
  Eye,
  Bell,
  Play,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { toast } from "sonner";

const services = [
  {
    icon: Radar,
    title: "Attack Surface Management",
    shortTitle: "ASM",
    tagline: "Know Your Entire Digital Footprint",
    description: "Continuously discover, inventory, and monitor all your external and cloud-facing assets. Our AI-powered platform identifies shadow IT, misconfigured services, and forgotten subdomains before attackers find them.",
    features: [
      { title: "Asset Discovery", desc: "Automatic discovery of all internet-facing assets" },
      { title: "Real-time Monitoring", desc: "24/7 monitoring for new exposures and changes" },
      { title: "Cloud Integration", desc: "Native AWS, Azure, GCP integrations" },
      { title: "Risk Scoring", desc: "AI-powered risk prioritization" },
    ],
    benefits: ["Reduce attack surface by 60%", "Find shadow IT in minutes", "Continuous asset inventory"],
    status: "available",
    href: "/app/asm",
    gradient: "from-primary to-accent",
    bgGradient: "from-primary/5 to-accent/5",
  },
  {
    icon: Bug,
    title: "Vulnerability Scanning",
    shortTitle: "VS",
    tagline: "Find Vulnerabilities Before Hackers Do",
    description: "High-fidelity vulnerability scanning with contextual prioritization. Our scanner identifies CVEs, misconfigurations, and security weaknesses while providing actionable remediation guidance tailored to your environment.",
    features: [
      { title: "Deep Scanning", desc: "Comprehensive vulnerability detection" },
      { title: "CVE Database", desc: "Real-time CVE intelligence and updates" },
      { title: "Auto Remediation", desc: "One-click fixes for common issues" },
      { title: "Compliance Reports", desc: "Ready-made audit documentation" },
    ],
    benefits: ["90% faster vulnerability detection", "Reduce false positives by 75%", "Automated fix suggestions"],
    status: "available",
    href: "/app/vs",
    gradient: "from-accent to-secondary",
    bgGradient: "from-accent/5 to-secondary/5",
  },
  {
    icon: Swords,
    title: "Breach & Attack Simulation",
    shortTitle: "BAS",
    tagline: "Test Your Defenses Like Real Attackers",
    description: "Automated adversary emulation to continuously test your security controls against real-world attack techniques mapped to MITRE ATT&CK framework. Identify gaps before they become breaches.",
    features: [
      { title: "MITRE ATT&CK", desc: "Full coverage of ATT&CK techniques" },
      { title: "Automated Testing", desc: "Continuous security validation" },
      { title: "Defense Validation", desc: "Test EDR, SIEM, and firewalls" },
      { title: "Gap Analysis", desc: "Detailed security gap reports" },
    ],
    benefits: ["Validate security controls 24/7", "Reduce breach risk by 80%", "Prove security ROI"],
    status: "coming-soon",
    gradient: "from-secondary to-warning",
    bgGradient: "from-secondary/5 to-warning/5",
  },
  {
    icon: Brain,
    title: "Threat Intelligence",
    shortTitle: "TI",
    tagline: "Stay Ahead of Emerging Threats",
    description: "Aggregated threat feeds with predictive analytics and contextual enrichment. Our platform correlates indicators of compromise with your environment to deliver actionable intelligence, not noise.",
    features: [
      { title: "Threat Feeds", desc: "Premium and OSINT feed aggregation" },
      { title: "IOC Management", desc: "Automated indicator lifecycle" },
      { title: "Dark Web Monitoring", desc: "Leaked credentials and data alerts" },
      { title: "Predictive Analytics", desc: "AI-powered threat forecasting" },
    ],
    benefits: ["Early warning on targeted threats", "Reduce alert fatigue by 70%", "Contextual threat insights"],
    status: "coming-soon",
    gradient: "from-warning to-destructive",
    bgGradient: "from-warning/5 to-destructive/5",
  },
  {
    icon: ShieldAlert,
    title: "Incident Response",
    shortTitle: "IR",
    tagline: "Respond Faster, Contain Better",
    description: "Orchestrated response workflows with automated playbooks and comprehensive case management. Reduce mean time to respond and contain incidents with guided investigation and automated actions.",
    features: [
      { title: "Playbook Automation", desc: "Customizable response workflows" },
      { title: "Case Management", desc: "Complete incident lifecycle tracking" },
      { title: "Forensics Tools", desc: "Built-in investigation capabilities" },
      { title: "Team Collaboration", desc: "Real-time team coordination" },
    ],
    benefits: ["80% faster incident response", "Consistent response procedures", "Complete audit trails"],
    status: "coming-soon",
    gradient: "from-destructive to-primary",
    bgGradient: "from-destructive/5 to-primary/5",
  },
  {
    icon: FileCheck,
    title: "Compliance & Audit",
    shortTitle: "CA",
    tagline: "Automate Your Compliance Journey",
    description: "Continuous compliance monitoring for SOC2, GDPR, HIPAA, ISO 27001, PCI-DSS, and more frameworks. Automate evidence collection, track control status, and generate audit-ready reports.",
    features: [
      { title: "Multi-Framework", desc: "Support for 15+ compliance frameworks" },
      { title: "Auto Evidence", desc: "Automated evidence collection" },
      { title: "Gap Analysis", desc: "Real-time compliance gap detection" },
      { title: "Audit Reports", desc: "One-click audit documentation" },
    ],
    benefits: ["50% less audit prep time", "Real-time compliance status", "Automated evidence collection"],
    status: "coming-soon",
    gradient: "from-success to-primary",
    bgGradient: "from-success/5 to-primary/5",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};

export default function ServicesPage() {
  const [notifyEmail, setNotifyEmail] = useState("");
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [expandedFeatures, setExpandedFeatures] = useState<string | null>(null);

  const handleNotify = (serviceName: string) => {
    if (!notifyEmail) {
      toast.error("Please enter your email address");
      return;
    }
    toast.success(`You'll be notified when ${serviceName} launches!`);
    setNotifyEmail("");
    setSelectedService(null);
  };

  const toggleFeatures = (serviceTitle: string) => {
    setExpandedFeatures(expandedFeatures === serviceTitle ? null : serviceTitle);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="pt-20">
        {/* Hero Section */}
        <section className="py-16 lg:py-24 relative overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
          </div>
          
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center max-w-4xl mx-auto"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
                <Shield className="w-4 h-4" />
                Our Security Products
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-bold text-foreground mb-6">
                Enterprise-Grade{" "}
                <span className="gradient-text">Security Suite</span>
              </h1>
              <p className="text-lg lg:text-xl text-muted-foreground max-w-3xl mx-auto mb-8">
                A comprehensive platform bringing together attack surface management, vulnerability scanning, 
                and security operations into one intelligent, unified cockpit.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button variant="gradient" size="lg" className="shadow-lg" asChild>
                  <Link to="/signup">
                    Start Free Trial
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link to="/contact">
                    <Play className="w-4 h-4 mr-2" />
                    Watch Demo
                  </Link>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-12 border-y border-border/50 bg-muted/30">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="grid grid-cols-2 lg:grid-cols-4 gap-8"
            >
              {[
                { icon: Shield, value: "6+", label: "Security Modules" },
                { icon: Globe, value: "500+", label: "Integrations" },
                { icon: Zap, value: "99.9%", label: "Uptime SLA" },
                { icon: Lock, value: "SOC2", label: "Certified" },
              ].map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="w-12 h-12 rounded-xl gradient-bg flex items-center justify-center mx-auto mb-3">
                    <stat.icon className="w-6 h-6 text-primary-foreground" />
                  </div>
                  <div className="text-3xl font-heading font-bold text-foreground">{stat.value}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Services Grid */}
        <section className="py-16 lg:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="space-y-12"
            >
              {services.map((service, index) => {
                const Icon = service.icon;
                const isAvailable = service.status === "available";
                const isEven = index % 2 === 0;

                return (
                  <motion.div
                    key={service.title}
                    variants={itemVariants}
                    className={`relative rounded-3xl border border-border/50 bg-gradient-to-br ${service.bgGradient} overflow-hidden`}
                  >
                    <div className={`grid lg:grid-cols-2 gap-8 lg:gap-12 p-6 lg:p-10 ${!isEven ? "lg:flex-row-reverse" : ""}`}>
                      {/* Content Side */}
                      <div className={`space-y-6 ${!isEven ? "lg:order-2" : ""}`}>
                        {/* Header */}
                        <div className="flex items-center gap-3">
                          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center bg-gradient-to-br ${service.gradient} shadow-lg`}>
                            <Icon className="w-7 h-7 text-white" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                {service.shortTitle}
                              </span>
                              {isAvailable ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-medium">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Available
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-medium">
                                  <Sparkles className="w-3 h-3" />
                                  Coming Soon
                                </span>
                              )}
                            </div>
                            <h2 className="text-2xl lg:text-3xl font-heading font-bold text-foreground">
                              {service.title}
                            </h2>
                          </div>
                        </div>

                        {/* Tagline */}
                        <p className="text-lg font-medium text-foreground/80">
                          {service.tagline}
                        </p>

                        {/* Description */}
                        <p className="text-muted-foreground leading-relaxed">
                          {service.description}
                        </p>

                        {/* Benefits */}
                        <div className="flex flex-wrap gap-3">
                          {service.benefits.map((benefit, idx) => (
                            <span 
                              key={idx}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/80 text-sm font-medium text-foreground border border-border/50"
                            >
                              <CheckCircle2 className="w-4 h-4 text-success" />
                              {benefit}
                            </span>
                          ))}
                        </div>

                        {/* CTA */}
                        <div className="flex flex-wrap items-center gap-4 pt-4">
                          {isAvailable ? (
                            <Button variant="gradient" size="lg" className="shadow-lg" asChild>
                              <Link to="/login">
                                Get Started
                                <ArrowRight className="w-5 h-5 ml-2" />
                              </Link>
                            </Button>
                          ) : selectedService === service.title ? (
                            <div className="flex gap-2 w-full max-w-md">
                              <Input
                                type="email"
                                placeholder="Enter your email"
                                value={notifyEmail}
                                onChange={(e) => setNotifyEmail(e.target.value)}
                                className="flex-1"
                              />
                              <Button variant="gradient" onClick={() => handleNotify(service.title)}>
                                <Bell className="w-4 h-4 mr-2" />
                                Notify Me
                              </Button>
                            </div>
                          ) : (
                            <Button 
                              variant="outline" 
                              size="lg"
                              className="border-dashed"
                              onClick={() => setSelectedService(service.title)}
                            >
                              <Sparkles className="w-4 h-4 mr-2" />
                              Request Early Access
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Features Side */}
                      <div className={`space-y-4 ${!isEven ? "lg:order-1" : ""}`}>
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                          Key Features
                        </h3>
                        <div className="grid sm:grid-cols-2 gap-4">
                          {service.features.map((feature, idx) => (
                            <div 
                              key={idx}
                              className="p-4 rounded-xl bg-background/80 border border-border/50 hover:border-primary/30 transition-colors"
                            >
                              <div className="flex items-center gap-3 mb-2">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br ${service.gradient} opacity-80`}>
                                  <CheckCircle2 className="w-4 h-4 text-white" />
                                </div>
                                <h4 className="font-semibold text-foreground">{feature.title}</h4>
                              </div>
                              <p className="text-sm text-muted-foreground pl-11">{feature.desc}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* Integration Section */}
        <section className="py-16 lg:py-24 bg-muted/30 border-y border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center max-w-3xl mx-auto mb-12"
            >
              <h2 className="text-3xl lg:text-4xl font-heading font-bold text-foreground mb-4">
                Integrates With Your Stack
              </h2>
              <p className="text-lg text-muted-foreground">
                Connect with 500+ tools and platforms you already use
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4"
            >
              {[
                { icon: Cloud, name: "AWS" },
                { icon: Server, name: "Azure" },
                { icon: Globe, name: "GCP" },
                { icon: Shield, name: "CrowdStrike" },
                { icon: Eye, name: "Splunk" },
                { icon: Target, name: "Jira" },
              ].map((integration, idx) => (
                <div 
                  key={idx}
                  className="flex flex-col items-center gap-2 p-6 rounded-xl bg-background border border-border/50 hover:border-primary/30 transition-colors"
                >
                  <integration.icon className="w-8 h-8 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{integration.name}</span>
                </div>
              ))}
            </motion.div>

            <div className="text-center mt-8">
              <Button variant="outline" asChild>
                <Link to="/contact">
                  View All Integrations
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 lg:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center max-w-3xl mx-auto p-8 lg:p-12 rounded-3xl bg-gradient-to-br from-primary/5 via-accent/5 to-secondary/5 border border-border/50"
            >
              <h2 className="text-3xl lg:text-4xl font-heading font-bold text-foreground mb-4">
                Ready to Secure Your Organization?
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Start with a 14-day free trial. No credit card required.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button variant="gradient" size="lg" className="shadow-lg shadow-primary/20" asChild>
                  <Link to="/signup">
                    Start Free Trial
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link to="/contact">Talk to Sales</Link>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
