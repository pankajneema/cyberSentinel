import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { Shield, Target, Users, Zap } from "lucide-react";
import { motion } from "framer-motion";

const values = [
  {
    icon: Shield,
    title: "Security First",
    description: "We build security into everything we do. Our platform is designed with a security-first mindset.",
  },
  {
    icon: Target,
    title: "Customer Focus",
    description: "We listen to our customers and build solutions that solve real security challenges.",
  },
  {
    icon: Users,
    title: "Collaboration",
    description: "We believe in the power of teamwork and collaboration to achieve great results.",
  },
  {
    icon: Zap,
    title: "Innovation",
    description: "We continuously innovate to stay ahead of emerging threats and deliver cutting-edge solutions.",
  },
];

const team = [
  { name: "Alex Chen", role: "CEO & Co-Founder", avatar: "AC" },
  { name: "Sarah Miller", role: "CTO & Co-Founder", avatar: "SM" },
  { name: "James Wilson", role: "VP of Engineering", avatar: "JW" },
  { name: "Emily Davis", role: "VP of Product", avatar: "ED" },
];

export default function About() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="pt-24 pb-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-3xl mx-auto mb-20"
          >
            <h1 className="text-4xl sm:text-5xl font-heading font-bold text-foreground mb-6">
              About <span className="gradient-text">CuriousDevs</span>
            </h1>
            <p className="text-lg text-muted-foreground">
              We're on a mission to make enterprise security accessible, unified, and actionable. 
              CyberSentinel was born from the frustration of managing dozens of disconnected security tools.
            </p>
          </motion.div>

          {/* Mission */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="card-elevated p-8 md:p-12 mb-20 text-center"
          >
            <h2 className="text-2xl font-heading font-bold text-foreground mb-4">Our Mission</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              To empower organizations of all sizes with unified cyber risk orchestration, 
              enabling them to predict threats, test defenses, and remediate vulnerabilities 
              faster than ever before.
            </p>
          </motion.div>

          {/* Values */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-20"
          >
            <h2 className="text-2xl font-heading font-bold text-foreground text-center mb-10">Our Values</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {values.map((value, index) => {
                const Icon = value.icon;
                return (
                  <motion.div
                    key={value.title}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className="card-elevated p-6 text-center"
                  >
                    <div className="w-12 h-12 rounded-xl gradient-bg flex items-center justify-center mx-auto mb-4">
                      <Icon className="w-6 h-6 text-primary-foreground" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">{value.title}</h3>
                    <p className="text-sm text-muted-foreground">{value.description}</p>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          {/* Team */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-2xl font-heading font-bold text-foreground text-center mb-10">Leadership Team</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-4xl mx-auto">
              {team.map((member, index) => (
                <motion.div
                  key={member.name}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="text-center"
                >
                  <div className="w-20 h-20 rounded-full gradient-bg flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-foreground">
                    {member.avatar}
                  </div>
                  <h3 className="font-semibold text-foreground">{member.name}</h3>
                  <p className="text-sm text-muted-foreground">{member.role}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
