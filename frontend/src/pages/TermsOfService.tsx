import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";

const borderColor = "rgba(15, 40, 80, 0.08)";

export default function TermsOfService() {
  const sections = [
    {
      title: "1. Agreement to Terms",
      content:
        "These Terms of Service ('Terms') constitute a legal agreement between you ('User' or 'you') and CyberSentinel ('Company,' 'we,' 'us,' or 'our'). By accessing and using this website and our services, you accept and agree to be bound by and comply with these Terms. If you do not agree to abide by the above, please do not use this service.",
    },
    {
      title: "2. Use License",
      content: `Permission is granted to temporarily download one copy of the materials (information or software) on CyberSentinel's website for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:

• Modify or copy the materials
• Use the materials for any commercial purpose or for any public display
• Attempt to decompile or reverse engineer any software contained on the website
• Remove any copyright or other proprietary notations from the materials
• Transferring the materials to another person or 'mirror' the materials on any other server
• Violating any applicable laws or regulations
• Using the materials to harass, abuse, threaten, or defame anyone`,
    },
    {
      title: "3. Disclaimer",
      content:
        "The materials on CyberSentinel's website are provided on an 'as is' basis. CyberSentinel makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.",
    },
    {
      title: "4. Limitations",
      content:
        "In no event shall CyberSentinel or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on CyberSentinel's website, even if CyberSentinel or a Company representative has been notified orally or in writing of the possibility of such damage.",
    },
    {
      title: "5. Accuracy of Materials",
      content:
        "The materials appearing on CyberSentinel's website could include technical, typographical, or photographic errors. CyberSentinel does not warrant that any of the materials on its website are accurate, complete, or current. CyberSentinel may make changes to the materials contained on its website at any time without notice.",
    },
    {
      title: "6. Links",
      content:
        "CyberSentinel has not reviewed all of the sites linked to its website and is not responsible for the contents of any such linked site. The inclusion of any link does not imply endorsement by CyberSentinel of the site. Use of any such linked website is at the user's own risk.",
    },
    {
      title: "7. Modifications",
      content:
        "CyberSentinel may revise these Terms for its website at any time without notice. By using this website, you are agreeing to be bound by the then current version of these Terms of Service.",
    },
    {
      title: "8. Governing Law",
      content:
        "These Terms and conditions are governed by and construed in accordance with the laws of India, and you irrevocably submit to the exclusive jurisdiction of the courts in that location.",
    },
    {
      title: "9. User Accounts",
      content: `If you create an account on our website, you are responsible for maintaining the confidentiality of your account information and password and for restricting access to your computer. You accept responsibility for all activities that occur under your account or password. You agree to notify us immediately of any unauthorized use of your account or password or any other breach of security.`,
    },
    {
      title: "10. Prohibited Conduct",
      content: `You agree not to engage in any of the following prohibited conduct:

• Posting content that is unlawful, threatening, abusive, defamatory, obscene, or otherwise objectionable
• Harassing or causing distress or inconvenience to any person
• Disrupting the normal flow of dialogue within the website through continuous, unwanted messages
• Attempting to gain unauthorized access to our systems
• Collecting or tracking personal information of others without consent
• Spamming or sending unsolicited messages`,
    },
    {
      title: "11. Contact Information",
      content:
        "If you have any questions about these Terms of Service or our website, please contact us at:\n\nCyberSentinel\nEmail: legal@cybersentinel.io\nPhone: +1 (555) 123-4567",
    },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F8FAFC" }}>
      <Navbar />

      <main className="pt-24 pb-24">
        <div className="mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
          {/* Header */}
          <div className="mb-12">
            <h1 className="font-heading text-[44px] sm:text-[52px] font-extrabold leading-[1.02] text-[#0D1B2A] mb-4" style={{ letterSpacing: "-1.5px" }}>
              Terms of Service
            </h1>
            <p className="text-[15px] font-light text-[#5A7184]">
              Last updated: May 1, 2026
            </p>
          </div>

          {/* Content */}
          <div className="space-y-8 mb-20">
            {sections.map((section, index) => (
              <div
                key={index}
                className="bg-white border rounded-[12px] p-6 md:p-8"
                style={{ borderColor }}
              >
                <h2 className="font-heading text-[20px] font-semibold text-[#0D1B2A] mb-4">
                  {section.title}
                </h2>
                <p className="text-[15px] font-light leading-7 text-[#5A7184] whitespace-pre-line">
                  {section.content}
                </p>
              </div>
            ))}
          </div>

          {/* Footer Note */}
          <div className="rounded-[12px] p-8 md:p-12 text-white" style={{ backgroundColor: "#0A5FFF" }}>
            <h2 className="font-heading text-[28px] font-bold mb-4" style={{ letterSpacing: "-1.5px" }}>
              Acceptance of Terms
            </h2>
            <p className="text-[15px] font-light leading-7" style={{ opacity: 0.9 }}>
              By using CyberSentinel services and website, you acknowledge that you have read these Terms of Service and agree to be bound by them. If you do not agree with any part of these terms, you must stop using our services immediately.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
