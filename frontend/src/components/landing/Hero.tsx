import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play, Shield, Radar, Bug, CheckCircle2, Zap, Terminal, Lock, Database, Server, Wifi, Eye, Scan } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

// Typing effect hook
const useTypingEffect = (texts: string[], typingSpeed = 100, deletingSpeed = 50, pauseTime = 2000) => {
  const [displayText, setDisplayText] = useState("");
  const [textIndex, setTextIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentText = texts[textIndex];
    
    const timeout = setTimeout(() => {
      if (!isDeleting) {
        if (displayText.length < currentText.length) {
          setDisplayText(currentText.slice(0, displayText.length + 1));
        } else {
          setTimeout(() => setIsDeleting(true), pauseTime);
        }
      } else {
        if (displayText.length > 0) {
          setDisplayText(displayText.slice(0, -1));
        } else {
          setIsDeleting(false);
          setTextIndex((prev) => (prev + 1) % texts.length);
        }
      }
    }, isDeleting ? deletingSpeed : typingSpeed);

    return () => clearTimeout(timeout);
  }, [displayText, isDeleting, textIndex, texts, typingSpeed, deletingSpeed, pauseTime]);

  return displayText;
};

// Terminal animation component
const TerminalAnimation = () => {
  const [lines, setLines] = useState<string[]>([]);
  const commands = [
    "$ cybersentinel scan --target *.company.com",
    "[+] Discovering subdomains...",
    "[+] Found 156 assets",
    "[!] Scanning for vulnerabilities...",
    "[+] CVE-2024-1234 detected (Critical)",
    "[+] CVE-2024-5678 detected (High)",
    "$ cybersentinel report --format pdf",
    "[✓] Report generated successfully",
  ];

  useEffect(() => {
    let currentLine = 0;
    const interval = setInterval(() => {
      if (currentLine < commands.length) {
        setLines(prev => [...prev.slice(-5), commands[currentLine]]);
        currentLine++;
      } else {
        currentLine = 0;
        setLines([]);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="font-mono text-xs space-y-1">
      <AnimatePresence mode="popLayout">
        {lines.map((line, i) => (
          <motion.div
            key={`${line}-${i}`}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className={
              line.startsWith("[!]") ? "text-warning" :
              line.startsWith("[✓]") ? "text-success" :
              line.includes("Critical") ? "text-destructive" :
              line.includes("High") ? "text-warning" :
              line.startsWith("$") ? "text-primary" :
              "text-muted-foreground"
            }
          >
            {line}
          </motion.div>
        ))}
      </AnimatePresence>
      <span className="inline-block w-2 h-4 bg-primary animate-pulse" />
    </div>
  );
};

// Floating security icons
const FloatingIcon = ({ Icon, delay, x, y }: { Icon: any; delay: number; x: string; y: string }) => (
  <motion.div
    className="absolute hidden lg:block"
    style={{ left: x, top: y }}
    initial={{ opacity: 0, scale: 0 }}
    animate={{ 
      opacity: [0.3, 0.6, 0.3], 
      scale: [1, 1.1, 1],
      y: [0, -10, 0],
    }}
    transition={{ 
      delay, 
      duration: 4, 
      repeat: Infinity,
      ease: "easeInOut"
    }}
  >
    <div className="p-3 rounded-xl bg-card/50 border border-border/30 backdrop-blur-sm">
      <Icon className="w-5 h-5 text-primary/60" />
    </div>
  </motion.div>
);

// Scan line animation
const ScanLine = () => (
  <motion.div
    className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
    animate={{ top: ["0%", "100%"] }}
    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
  />
);

// Particle effect
const Particles = () => {
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    duration: Math.random() * 20 + 10,
    delay: Math.random() * 5,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-primary/20"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
          }}
          animate={{
            y: [0, -100, 0],
            opacity: [0, 1, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      ))}
    </div>
  );
};

export function Hero() {
  const typedText = useTypingEffect([
    "Attack Surface",
    "Vulnerabilities", 
    "Security Posture",
    "Threat Landscape",
  ], 80, 40, 2000);

  const [scanProgress, setScanProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setScanProgress((prev) => (prev >= 100 ? 0 : prev + 1));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 -z-10">
        {/* Gradient orbs */}
        <motion.div 
          className="absolute top-1/4 left-[15%] w-[500px] h-[500px] bg-primary/8 rounded-full blur-[100px]"
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.5, 0.8, 0.5],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div 
          className="absolute bottom-1/4 right-[15%] w-[400px] h-[400px] bg-accent/8 rounded-full blur-[100px]"
          animate={{ 
            scale: [1, 1.3, 1],
            opacity: [0.5, 0.7, 0.5],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />
        <motion.div 
          className="absolute top-[60%] left-[50%] w-[300px] h-[300px] bg-secondary/6 rounded-full blur-[80px]"
          animate={{ 
            scale: [1, 1.1, 1],
            x: [-50, 50, -50],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        
        {/* Grid pattern with pulse */}
        <motion.div 
          className="absolute inset-0 opacity-[0.02]"
          animate={{ opacity: [0.02, 0.04, 0.02] }}
          transition={{ duration: 4, repeat: Infinity }}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}
        />

        {/* Particles */}
        <Particles />

        {/* Animated rings */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px]">
          <motion.div 
            className="absolute inset-0 rounded-full border border-primary/5"
            animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.6, 0.3], rotate: [0, 360] }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          />
          <motion.div 
            className="absolute inset-12 rounded-full border border-accent/5"
            animate={{ scale: [1, 1.03, 1], opacity: [0.3, 0.6, 0.3], rotate: [360, 0] }}
            transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          />
          <motion.div 
            className="absolute inset-24 rounded-full border border-secondary/5"
            animate={{ scale: [1, 1.02, 1], opacity: [0.3, 0.6, 0.3], rotate: [0, 360] }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          />
        </div>

        {/* Floating Icons */}
        <FloatingIcon Icon={Shield} delay={0} x="10%" y="20%" />
        <FloatingIcon Icon={Lock} delay={0.5} x="85%" y="15%" />
        <FloatingIcon Icon={Terminal} delay={1} x="5%" y="60%" />
        <FloatingIcon Icon={Database} delay={1.5} x="90%" y="55%" />
        <FloatingIcon Icon={Server} delay={2} x="15%" y="80%" />
        <FloatingIcon Icon={Wifi} delay={2.5} x="80%" y="75%" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center lg:text-left"
          >
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border/80 shadow-sm mb-8"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
              </span>
              <span className="text-sm font-medium text-foreground">ASM & Vulnerability Scanning Now Live</span>
            </motion.div>

            {/* Headline with typing effect */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-[68px] font-heading font-bold text-foreground leading-[1.1] mb-6 tracking-tight">
              Discover Your{" "}
              <span className="gradient-text block sm:inline min-h-[1.2em]">
                {typedText}
                <span className="animate-pulse">|</span>
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-muted-foreground mb-10 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              CyberSentinel combines ASM, automated vulnerability scanning, adversary emulation, and compliance automation into a single cockpit.{" "}
              <span className="font-semibold text-foreground">Predict. Test. Remediate.</span>
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Button variant="hero" size="xl" asChild className="group">
                <Link to="/signup">
                  Start Free Trial
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button variant="outline" size="xl" asChild className="group border-2">
                <Link to="/contact">
                  <Play className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  Watch Demo
                </Link>
              </Button>
            </div>

            {/* Trust indicators */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="mt-12 pt-8 border-t border-border/50"
            >
              <p className="text-sm text-muted-foreground mb-5">Trusted by security teams worldwide</p>
              <div className="flex items-center gap-8 justify-center lg:justify-start">
                {[
                  { value: "500K+", label: "Vulnerabilities Found" },
                  { value: "120+", label: "Organizations" },
                  { value: "99.9%", label: "Uptime SLA" },
                ].map((stat, index) => (
                  <motion.div 
                    key={index} 
                    className="text-center lg:text-left"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.9 + index * 0.1 }}
                  >
                    <div className="text-2xl sm:text-3xl font-bold text-foreground">{stat.value}</div>
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </motion.div>

          {/* Right Visual - Terminal Style Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative lg:pl-8"
          >
            {/* Main Card - Terminal Style */}
            <div className="relative z-10 rounded-2xl overflow-hidden border border-border/50 bg-card/95 backdrop-blur-sm shadow-2xl">
              {/* Terminal Header */}
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/50 border-b border-border/50">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-destructive/80" />
                  <div className="w-3 h-3 rounded-full bg-warning/80" />
                  <div className="w-3 h-3 rounded-full bg-success/80" />
                </div>
                <div className="flex-1 text-center">
                  <span className="text-xs font-mono text-muted-foreground">cybersentinel@security ~ </span>
                </div>
                <Terminal className="w-4 h-4 text-muted-foreground" />
              </div>

              {/* Terminal Content */}
              <div className="p-6 min-h-[300px] bg-background/50 relative overflow-hidden">
                <ScanLine />
                <TerminalAnimation />
              </div>

              {/* Status Bar */}
              <div className="px-4 py-3 bg-muted/30 border-t border-border/50">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-primary" />
                      <span className="text-muted-foreground">Monitoring</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Scan className="w-3.5 h-3.5 text-success animate-pulse" />
                      <span className="text-muted-foreground">Active Scan</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${scanProgress}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground font-mono">{scanProgress}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Security Score Card */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.8 }}
              className="absolute -left-4 top-1/4 bg-card rounded-xl p-4 shadow-lg border border-border/50 hidden lg:block"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl gradient-bg flex items-center justify-center">
                  <Shield className="w-6 h-6 text-primary-foreground" />
                </div>
                <div>
                  <div className="text-2xl font-bold gradient-text">87</div>
                  <div className="text-xs text-muted-foreground">Security Score</div>
                </div>
              </div>
            </motion.div>

            {/* Vulnerability Counter */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1 }}
              className="absolute -right-4 bottom-1/4 bg-card rounded-xl p-4 shadow-lg border border-border/50 hidden lg:block"
            >
              <div className="flex items-center gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-destructive" />
                    <span className="text-xs text-muted-foreground">2 Critical</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-warning" />
                    <span className="text-xs text-muted-foreground">8 High</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-success" />
                    <span className="text-xs text-muted-foreground">156 Secured</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Decorative elements */}
            <div className="absolute -top-6 -right-6 w-24 h-24 gradient-bg rounded-3xl opacity-10 blur-xl" />
            <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-accent/20 rounded-3xl blur-xl" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}