import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";

const borderColor = "rgba(15, 40, 80, 0.08)";

const positions = [
  {
    title: "Senior Security Engineer",
    department: "Engineering",
    location: "Remote / India",
    level: "Senior",
    description:
      "Build next-gen attack surface management capabilities. Work on vulnerability detection, asset discovery, and threat intelligence systems.",
    type: "Full-time",
  },
  {
    title: "Full Stack Developer",
    department: "Engineering",
    location: "Remote / India",
    level: "Mid-level",
    description:
      "Design and develop scalable backend services and modern frontend interfaces for security operations. Tech stack: Python, Go, React, TypeScript.",
    type: "Full-time",
  },
  {
    title: "DevOps / Infrastructure Engineer",
    department: "Infrastructure",
    location: "Remote / India",
    level: "Mid-level",
    description:
      "Build and maintain our cloud infrastructure, CI/CD pipelines, and deployment systems. Kubernetes, Docker, Terraform experience required.",
    type: "Full-time",
  },
  {
    title: "Product Manager",
    department: "Product",
    location: "Remote",
    level: "Mid-level",
    description:
      "Drive product vision and roadmap for one of our modules (ASM, VS, Compliance). Work closely with customers and engineering teams.",
    type: "Full-time",
  },
  {
    title: "Security Researcher",
    department: "Research",
    location: "Remote",
    level: "Senior",
    description:
      "Research emerging threats, vulnerability patterns, and attack vectors. Help shape our threat intelligence and detection capabilities.",
    type: "Full-time",
  },
  {
    title: "Sales Development Representative",
    department: "Sales",
    location: "Remote / India",
    level: "Entry-level",
    description:
      "Engage with prospects, qualify leads, and help grow our customer base. Support sales team in customer acquisition efforts.",
    type: "Full-time",
  },
];

const perks = [
  {
    title: "Competitive Salary",
    description: "Market-leading compensation with equity",
  },
  {
    title: "Global Team",
    description: "Work with talented professionals worldwide",
  },
  {
    title: "Flexible Work",
    description: "Remote-first culture with flexibility",
  },
  {
    title: "Learning Budget",
    description: "$2000 annual professional development",
  },
];



export default function Career() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F8FAFC" }}>
      <Navbar />

      <main className="pt-24 pb-24">
        <div className="mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
          {/* Hero */}
          <div className="max-w-3xl mb-20">
            <h1 className="font-heading text-[44px] sm:text-[52px] font-extrabold leading-[1.02] text-[#0D1B2A] mb-6" style={{ letterSpacing: "-1.5px" }}>
              Join the <span style={{ color: "#0A5FFF" }}>CyberSentinel</span> Team
            </h1>
            <p className="text-[15px] font-light leading-7 text-[#5A7184] max-w-2xl mb-8">
              Help us build the future of cybersecurity. We're hiring talented engineers, researchers, and builders who are passionate about security.
            </p>
          </div>

          {/* Why Join Us */}
          <div className="max-w-4xl mx-auto mb-20">
            <div className="bg-white border rounded-[12px] p-8 md:p-12" style={{ borderColor }}>
              <h2 className="font-heading text-[28px] md:text-[32px] font-semibold text-[#0D1B2A] mb-6" style={{ letterSpacing: "-1.5px" }}>
                Why Join CyberSentinel
              </h2>
              <p className="text-[15px] font-light leading-7 text-[#5A7184] mb-4">
                We're not just building another security tool. We're democratizing enterprise-grade security for organizations of all sizes. Our team is made up of security professionals, full-stack engineers, and visionaries who share a common goal: making cybersecurity accessible and effective for everyone.
              </p>
              <p className="text-[15px] font-light leading-7 text-[#5A7184]">
                If you're passionate about security, love solving complex problems, and want to make a real impact on the cybersecurity landscape, we'd love to meet you.
              </p>
            </div>
          </div>

          {/* Perks */}
          <div className="mb-20">
            <h2 className="font-heading text-[28px] md:text-[32px] font-semibold text-[#0D1B2A] mb-12 text-center" style={{ letterSpacing: "-1.5px" }}>
              What We Offer
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {perks.map((perk) => (
                <div
                  key={perk.title}
                  className="bg-white border rounded-[12px] p-6 transition-colors"
                  style={{ borderColor }}
                >
                  <div className="w-8 h-8 mb-4" style={{ color: "#0A5FFF" }}>■</div>
                  <h3 className="font-heading font-semibold text-[#0D1B2A] mb-2 text-[15px]">{perk.title}</h3>
                  <p className="text-[13px] font-light text-[#5A7184]">{perk.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Open Positions */}
          <div className="mb-20">
            <h2 className="font-heading text-[28px] md:text-[32px] font-semibold text-[#0D1B2A] mb-12 text-center" style={{ letterSpacing: "-1.5px" }}>
              Open Positions
            </h2>
            <div className="bg-white border rounded-[12px] p-12 text-center" style={{ borderColor }}>
              <p className="text-[16px] font-light text-[#5A7184] mb-4">
                We're not actively hiring at the moment, but we're always interested in exceptional talent.
              </p>
              <p className="text-[15px] font-light text-[#A0B4C4] mb-8">
                If you'd like to explore opportunities with CyberSentinel in the future, feel free to reach out.
              </p>
              <Button
                className="h-11 rounded-xl border px-6 text-[15px] font-normal shadow-none transition-colors"
                style={{ backgroundColor: "#0A5FFF", color: "white", borderColor: "#0A5FFF" }}
                asChild
              >
                <a href="/contact?subject=Future%20Opportunities">Get in Touch</a>
              </Button>
            </div>
          </div>

          {/* CTA */}
          <div className="rounded-[12px] p-8 md:p-12 text-center" style={{ backgroundColor: "#0A5FFF" }}>
            <h2 className="font-heading text-[28px] md:text-[32px] font-bold text-white mb-4" style={{ letterSpacing: "-1.5px" }}>
              Don't See Your Role?
            </h2>
            <p className="text-[15px] font-light leading-7 text-white mb-8 max-w-2xl mx-auto" style={{ opacity: 0.9 }}>
              We're always looking for talented people. If you're interested in joining our team, send us your resume and tell us how you'd like to contribute.
            </p>
            <Button
              className="h-11 rounded-xl border px-6 text-[15px] font-normal shadow-none transition-colors"
              style={{ backgroundColor: "white", color: "#0A5FFF", borderColor: "white" }}
              asChild
            >
              <a href="/contact?subject=General%20Application">Get in Touch</a>
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
