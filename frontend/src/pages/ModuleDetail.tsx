import { useParams, Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useState } from "react";
import { ArrowLeft, Shield, Search, Bug, Lock, Activity, Eye, CheckCircle2 } from "lucide-react";

const MODULES: Record<string, {
  icon: any; title: string; tagline: string;
  description: string; features: string[]; useCases: string[];
}> = {
  asm: {
    icon: Search, title: "Attack Surface Management",
    tagline: "Discover every asset before attackers do.",
    description: "CyberSentinel ASM continuously maps your external attack surface — domains, subdomains, IPs, cloud assets, exposed services, and shadow IT. We correlate findings into a live hierarchy so your team sees risk the way an attacker does.",
    features: [
      "Continuous subdomain & DNS enumeration",
      "Exposed port & service fingerprinting",
      "Cloud asset discovery (AWS, GCP, Azure)",
      "Shadow IT & forgotten asset detection",
      "Risk-scored asset hierarchy",
      "Real-time change alerts",
    ],
    useCases: [
      "M&A due diligence — map acquired company's exposure",
      "Pre-pentest scoping",
      "Compliance asset inventory (SOC2, ISO 27001)",
      "Continuous monitoring for digital transformation",
    ],
  },
  vs: {
    icon: Bug, title: "Vulnerability Scanning",
    tagline: "Find what matters. Skip the noise.",
    description: "Authenticated and unauthenticated scanning across web apps, APIs, and infrastructure. Risk-prioritized findings with exploitability context — no more 10,000-line CSV dumps.",
    features: ["OWASP Top 10 + API Top 10 coverage", "Authenticated scanning", "CVSS + EPSS risk scoring", "Auto-triaged false positives", "Compliance mapping", "CI/CD integration"],
    useCases: ["Pre-release security gates", "PCI-DSS / HIPAA scans", "Third-party vendor assessments", "Continuous prod monitoring"],
  },
  // add more as needed
};

export default function ModuleDetail() {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const mod = MODULES[moduleId ?? "asm"] ?? MODULES.asm;
  const Icon = mod.icon;
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const [sent, setSent] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: wire to your backend / Formspree / etc.
    setSent(true);
    setTimeout(() => navigate("/"), 2500);
  };

  return (
    <div className="landing-dark min-h-screen">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-sm opacity-70 hover:opacity-100 mb-8">
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>

        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-xl glow-border flex items-center justify-center">
            <Icon className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-4xl font-bold grad-text">{mod.title}</h1>
            <p className="opacity-70 mt-1">{mod.tagline}</p>
          </div>
        </div>

        <p className="text-lg opacity-80 mt-6 max-w-3xl">{mod.description}</p>

        <div className="grid md:grid-cols-2 gap-8 mt-12">
          <div>
            <h2 className="text-2xl font-semibold mb-4">Capabilities</h2>
            <ul className="space-y-3">
              {mod.features.map((f) => (
                <li key={f} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 mt-0.5 text-emerald-400 shrink-0" />
                  <span className="opacity-90">{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-semibold mb-4">Use Cases</h2>
            <ul className="space-y-3">
              {mod.useCases.map((u) => (
                <li key={u} className="flex items-start gap-3">
                  <Shield className="w-5 h-5 mt-0.5 text-indigo-400 shrink-0" />
                  <span className="opacity-90">{u}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Lead capture */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          className="mt-16 glow-border rounded-2xl p-8"
        >
          <h2 className="text-3xl font-bold mb-2">Talk to our team</h2>
          <p className="opacity-70 mb-6">Get a personalized walkthrough of {mod.title} for your environment.</p>

          {sent ? (
            <div className="text-emerald-400 text-lg">✓ Thanks! We'll be in touch within 24 hours.</div>
          ) : (
            <form onSubmit={submit} className="grid md:grid-cols-2 gap-4">
              <input required placeholder="Your name" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-indigo-400" />
              <input required type="email" placeholder="Work email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-indigo-400" />
              <input placeholder="Company" value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 md:col-span-2 outline-none focus:border-indigo-400" />
              <textarea placeholder="Tell us about your use case" rows={4} value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 md:col-span-2 outline-none focus:border-indigo-400" />
              <button className="md:col-span-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-lg py-3 font-semibold hover:opacity-90">
                Request a demo
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
