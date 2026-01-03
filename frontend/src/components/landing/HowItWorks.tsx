import { Radar, Search, Wrench, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  {
    icon: Radar,
    title: "Discover",
    description: "Automatically discover all your external assets, cloud resources, and shadow IT across your attack surface.",
    color: "primary",
  },
  {
    icon: Search,
    title: "Test",
    description: "Run continuous vulnerability scans and attack simulations to identify weaknesses before attackers do.",
    color: "accent",
  },
  {
    icon: Wrench,
    title: "Remediate",
    description: "Prioritized remediation guidance with automated workflows and integrations to fix issues fast.",
    color: "secondary",
  },
];

export function HowItWorks() {
  return (
    <section className="py-24 bg-muted/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground mb-4">
            How It <span className="gradient-text">Works</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Three simple steps to comprehensive security visibility and control
          </p>
        </motion.div>

        {/* Steps */}
        <div className="relative">
          {/* Connection Line */}
          <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-accent to-secondary -translate-y-1/2" />

          <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
            {steps.map((step, index) => {
              const Icon = step.icon;
              
              return (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.2 }}
                  className="relative"
                >
                  <div className="text-center">
                    {/* Step Number */}
                    <div className="relative inline-flex mb-6">
                      <div className={`w-20 h-20 rounded-2xl flex items-center justify-center bg-card border-2 border-${step.color} shadow-lg`}>
                        <Icon className={`w-8 h-8 text-${step.color}`} />
                      </div>
                      <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full gradient-bg flex items-center justify-center text-sm font-bold text-primary-foreground shadow-md">
                        {index + 1}
                      </div>
                    </div>

                    {/* Content */}
                    <h3 className="text-xl font-heading font-semibold text-foreground mb-3">
                      {step.title}
                    </h3>
                    <p className="text-muted-foreground max-w-sm mx-auto">
                      {step.description}
                    </p>
                  </div>

                  {/* Arrow (mobile/tablet) */}
                  {index < steps.length - 1 && (
                    <div className="lg:hidden flex justify-center my-6">
                      <ArrowRight className="w-6 h-6 text-muted-foreground rotate-90" />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
