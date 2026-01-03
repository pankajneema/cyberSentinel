import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { 
  Radar, 
  Bug, 
  Swords, 
  Brain, 
  ShieldAlert, 
  FileCheck,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Zap,
  Shield,
  Lock
} from "lucide-react";
import { motion } from "framer-motion";

const services = [
  {
    icon: Radar,
    title: "Attack Surface Management",
    shortTitle: "ASM",
    description: "Continuously discover all your external & cloud assets and prioritize exposures with AI-powered risk scoring.",
    features: ["Asset Discovery", "Risk Scoring", "Cloud Integration", "Real-time Monitoring"],
    status: "available",
    href: "/app/asm",
    gradient: "from-primary to-accent",
    bgGradient: "from-primary/10 via-primary/5 to-transparent",
  },
  {
    icon: Bug,
    title: "Vulnerability Scanning",
    shortTitle: "VS",
    description: "High-fidelity vulnerability scanning with contextual prioritization and automated remediation guidance.",
    features: ["Deep Scanning", "CVE Database", "Auto Remediation", "Compliance Reports"],
    status: "available",
    href: "/app/vs",
    gradient: "from-accent to-secondary",
    bgGradient: "from-accent/10 via-accent/5 to-transparent",
  },
  {
    icon: Swords,
    title: "Breach & Attack Simulation",
    shortTitle: "BAS",
    description: "Automated adversary emulation to test your defenses against real-world attack techniques and TTPs.",
    features: ["MITRE ATT&CK", "Automated Testing", "Defense Validation", "Gap Analysis"],
    status: "coming-soon",
    gradient: "from-secondary to-warning",
    bgGradient: "from-secondary/10 via-secondary/5 to-transparent",
  },
  {
    icon: Brain,
    title: "Threat Intelligence",
    shortTitle: "TI",
    description: "Aggregated threat feeds with predictive analytics and contextual enrichment for proactive defense.",
    features: ["Threat Feeds", "IOC Management", "Dark Web Monitoring", "Predictive Analytics"],
    status: "coming-soon",
    gradient: "from-warning to-destructive",
    bgGradient: "from-warning/10 via-warning/5 to-transparent",
  },
  {
    icon: ShieldAlert,
    title: "Incident Response",
    shortTitle: "IR",
    description: "Orchestrated response workflows with automated playbooks and comprehensive case management.",
    features: ["Playbook Automation", "Case Management", "Forensics Tools", "Team Collaboration"],
    status: "coming-soon",
    gradient: "from-destructive to-primary",
    bgGradient: "from-destructive/10 via-destructive/5 to-transparent",
  },
  {
    icon: FileCheck,
    title: "Compliance & Audit",
    shortTitle: "CA",
    description: "Continuous compliance monitoring for SOC2, GDPR, HIPAA, ISO 27001 and more frameworks.",
    features: ["Multi-Framework", "Auto Evidence", "Gap Analysis", "Audit Reports"],
    status: "coming-soon",
    gradient: "from-success to-primary",
    bgGradient: "from-success/10 via-success/5 to-transparent",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 100,
      damping: 15
    }
  },
};

export function Features() {
  return (
    <section id="features" className="py-24 lg:py-32 relative overflow-hidden bg-muted/30">
      {/* Background Effects */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-4xl mx-auto mb-16 lg:mb-20"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Shield className="w-4 h-4" />
            Our Products & Services
          </div>
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-bold text-foreground mb-6">
            Complete Security{" "}
            <span className="gradient-text">Orchestration</span>
          </h2>
          <p className="text-lg lg:text-xl text-muted-foreground max-w-3xl mx-auto">
            A unified platform bringing together attack surface management, vulnerability scanning, 
            and security operations into one intelligent cockpit.
          </p>
        </motion.div>

        {/* Stats Bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8 mb-16 lg:mb-20"
        >
          {[
            { value: "6+", label: "Security Modules", icon: Lock },
            { value: "99.9%", label: "Uptime SLA", icon: Zap },
            { value: "24/7", label: "Monitoring", icon: Shield },
            { value: "500+", label: "Integrations", icon: Sparkles },
          ].map((stat, index) => (
            <div 
              key={index}
              className="flex items-center gap-4 p-4 lg:p-6 rounded-2xl bg-background/80 backdrop-blur-sm border border-border/50"
            >
              <div className="w-12 h-12 rounded-xl gradient-bg flex items-center justify-center shrink-0">
                <stat.icon className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <div className="text-2xl lg:text-3xl font-heading font-bold text-foreground">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Services Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid lg:grid-cols-2 gap-6 lg:gap-8"
        >
          {services.map((service, index) => {
            const Icon = service.icon;
            const isAvailable = service.status === "available";
            
            return (
              <motion.div
                key={service.title}
                variants={itemVariants}
                className={`group relative rounded-3xl border border-border/50 bg-background/80 backdrop-blur-sm overflow-hidden transition-all duration-500 ${
                  isAvailable 
                    ? "hover:border-primary/50 hover:shadow-2xl hover:shadow-primary/10" 
                    : "opacity-80"
                }`}
              >
                {/* Background Gradient */}
                <div className={`absolute inset-0 bg-gradient-to-br ${service.bgGradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                
                {/* Content */}
                <div className="relative p-6 lg:p-8">
                  {/* Header Row */}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                      {/* Icon */}
                      <div className={`w-14 h-14 lg:w-16 lg:h-16 rounded-2xl flex items-center justify-center bg-gradient-to-br ${service.gradient} shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
                        <Icon className="w-7 h-7 lg:w-8 lg:h-8 text-white" />
                      </div>
                      
                      {/* Title & Badge */}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                            {service.shortTitle}
                          </span>
                          {isAvailable ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-medium">
                              <CheckCircle2 className="w-3 h-3" />
                              Live
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-medium">
                              <Sparkles className="w-3 h-3" />
                              Soon
                            </span>
                          )}
                        </div>
                        <h3 className="text-xl lg:text-2xl font-heading font-bold text-foreground">
                          {service.title}
                        </h3>
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-muted-foreground mb-6 leading-relaxed">
                    {service.description}
                  </p>

                  {/* Features Pills */}
                  <div className="flex flex-wrap gap-2 mb-6">
                    {service.features.map((feature, idx) => (
                      <span 
                        key={idx}
                        className="px-3 py-1.5 rounded-full bg-muted/80 text-muted-foreground text-xs font-medium border border-border/50"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>

                  {/* CTA */}
                  <div className="flex items-center gap-4">
                    {isAvailable ? (
                      <>
                        <Button 
                          variant="gradient" 
                          className="group/btn shadow-lg shadow-primary/20"
                          asChild
                        >
                          <Link to={service.href!}>
                            Get Started
                            <ArrowRight className="w-4 h-4 ml-2 group-hover/btn:translate-x-1 transition-transform" />
                          </Link>
                        </Button>
                        <Button variant="ghost" asChild>
                          <Link to={service.href!}>
                            Learn More
                          </Link>
                        </Button>
                      </>
                    ) : (
                      <Button 
                        variant="outline" 
                        className="border-dashed"
                        onClick={() => {}}
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Request Early Access
                      </Button>
                    )}
                  </div>
                </div>

                {/* Decorative Corner */}
                {isAvailable && (
                  <div className="absolute top-0 right-0 w-32 h-32 overflow-hidden">
                    <div className={`absolute -top-16 -right-16 w-32 h-32 bg-gradient-to-br ${service.gradient} opacity-10 rotate-45 group-hover:opacity-20 transition-opacity`} />
                  </div>
                )}
              </motion.div>
            );
          })}
        </motion.div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mt-16 lg:mt-20"
        >
          <div className="inline-flex flex-col sm:flex-row items-center gap-4 p-6 lg:p-8 rounded-3xl bg-gradient-to-r from-primary/5 via-accent/5 to-secondary/5 border border-border/50">
            <div className="text-center sm:text-left">
              <h3 className="text-xl font-heading font-bold text-foreground mb-1">
                Ready to secure your organization?
              </h3>
              <p className="text-muted-foreground">
                Start with a free trial and see the difference.
              </p>
            </div>
            <Button variant="gradient" size="lg" className="shadow-lg shadow-primary/20" asChild>
              <Link to="/signup">
                Start Free Trial
                <ArrowRight className="w-5 h-5 ml-2" />
              </Link>
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
