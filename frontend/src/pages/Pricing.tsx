import { useState } from "react";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Check, HelpCircle } from "lucide-react";
import { motion } from "framer-motion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const plans = [
  {
    name: "Starter",
    price: { monthly: 499, annual: 399 },
    description: "Essential security visibility for growing teams",
    features: [
      { name: "ASM - Attack Surface Management", included: true },
      { name: "Basic external scans", included: true },
      { name: "Up to 100 assets", included: true },
      { name: "Weekly reports", included: true },
      { name: "Email support", included: true },
      { name: "Vulnerability Scanning", included: false },
      { name: "Scheduled scans", included: false },
      { name: "API access", included: false },
      { name: "SSO/SAML", included: false },
    ],
    cta: "Start Free Trial",
    popular: false,
  },
  {
    name: "Pro",
    price: { monthly: 999, annual: 799 },
    description: "Advanced scanning and prioritization",
    features: [
      { name: "ASM - Attack Surface Management", included: true },
      { name: "Vulnerability Scanning", included: true },
      { name: "Scheduled scans", included: true },
      { name: "Up to 500 assets", included: true },
      { name: "Priority support", included: true },
      { name: "Slack integration", included: true },
      { name: "API access", included: true },
      { name: "Weekly & daily reports", included: true },
      { name: "SSO/SAML", included: false },
    ],
    cta: "Start Free Trial",
    popular: true,
  },
  {
    name: "Enterprise",
    price: { monthly: null, annual: null },
    description: "Full platform with dedicated support",
    features: [
      { name: "Everything in Pro", included: true },
      { name: "Unlimited assets", included: true },
      { name: "SSO & SAML", included: true },
      { name: "On-prem connector", included: true },
      { name: "Dedicated CSM", included: true },
      { name: "Custom integrations", included: true },
      { name: "SLA guarantee", included: true },
      { name: "Early access to new features", included: true },
      { name: "Training & onboarding", included: true },
    ],
    cta: "Contact Sales",
    popular: false,
  },
];

const faqs = [
  {
    question: "What's included in the free trial?",
    answer: "Our 14-day free trial includes full access to ASM and Vulnerability Scanning features with up to 50 assets. No credit card required.",
  },
  {
    question: "Can I change plans later?",
    answer: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle.",
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept all major credit cards (Visa, Mastercard, American Express) and can arrange invoicing for Enterprise plans.",
  },
  {
    question: "Is there a setup fee?",
    answer: "No, there are no setup fees for any plan. You only pay the subscription cost.",
  },
];

export default function Pricing() {
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("annual");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="pt-24 pb-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-3xl mx-auto mb-12"
          >
            <h1 className="text-4xl sm:text-5xl font-heading font-bold text-foreground mb-4">
              Simple, Transparent <span className="gradient-text">Pricing</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              Start with a 14-day free trial. No credit card required.
            </p>

            {/* Billing Toggle */}
            <div className="inline-flex items-center gap-4 p-1 bg-muted rounded-lg">
              <button
                onClick={() => setBillingPeriod("monthly")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  billingPeriod === "monthly"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingPeriod("annual")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  billingPeriod === "annual"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Annual
                <span className="ml-2 text-xs text-success">Save 20%</span>
              </button>
            </div>
          </motion.div>

          {/* Pricing Cards */}
          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto mb-20">
            {plans.map((plan, index) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`relative card-elevated p-8 ${
                  plan.popular ? "border-2 border-primary shadow-glow" : ""
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-4 py-1 rounded-full gradient-bg text-primary-foreground text-sm font-medium">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="text-center mb-8">
                  <h3 className="text-xl font-heading font-semibold text-foreground mb-2">
                    {plan.name}
                  </h3>
                  <div className="flex items-baseline justify-center gap-1 mb-2">
                    {plan.price.monthly ? (
                      <>
                        <span className="text-4xl font-bold text-foreground">
                          ${billingPeriod === "monthly" ? plan.price.monthly : plan.price.annual}
                        </span>
                        <span className="text-muted-foreground">/month</span>
                      </>
                    ) : (
                      <span className="text-4xl font-bold text-foreground">Custom</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature.name} className="flex items-start gap-3">
                      {feature.included ? (
                        <Check className="w-5 h-5 text-success shrink-0 mt-0.5" />
                      ) : (
                        <div className="w-5 h-5 shrink-0" />
                      )}
                      <span className={`text-sm ${feature.included ? "text-foreground" : "text-muted-foreground line-through"}`}>
                        {feature.name}
                      </span>
                    </li>
                  ))}
                </ul>

                <Button
                  variant={plan.popular ? "gradient" : "outline"}
                  className="w-full"
                  asChild
                >
                  <Link to={plan.name === "Enterprise" ? "/contact" : "/signup"}>
                    {plan.cta}
                  </Link>
                </Button>
              </motion.div>
            ))}
          </div>

          {/* FAQs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto"
          >
            <h2 className="text-2xl font-heading font-bold text-foreground text-center mb-8">
              Frequently Asked Questions
            </h2>
            <div className="space-y-4">
              {faqs.map((faq) => (
                <div key={faq.question} className="card-elevated p-6">
                  <h3 className="font-semibold text-foreground mb-2">{faq.question}</h3>
                  <p className="text-sm text-muted-foreground">{faq.answer}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
