import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";

const borderColor = "rgba(15, 40, 80, 0.08)";

export default function CookiePolicy() {
  const sections = [
    {
      title: "1. What Are Cookies?",
      content:
        "Cookies are small pieces of data stored on your device (computer, tablet, or mobile phone) when you visit a website. Cookies help websites remember information about your visit, such as your preferences and login details. They can be either temporary (session cookies) or permanent (persistent cookies).",
    },
    {
      title: "2. How We Use Cookies",
      content: `CyberSentinel uses cookies for various purposes:

• Essential Cookies: These cookies are necessary for the website to function properly. They enable basic functions like page navigation and access to secure areas of the website.

• Analytical Cookies: We use these cookies to understand how visitors use our website. This helps us improve website functionality and user experience.

• Performance Cookies: These cookies collect information about how visitors interact with our website, helping us optimize performance and loading times.

• Functional Cookies: These cookies remember your preferences and choices to provide a personalized experience.

• Marketing Cookies: We may use these cookies to track your browsing habits and target relevant advertisements to you.`,
    },
    {
      title: "3. Types of Cookies We Use",
      content: `First-Party Cookies: Set directly by CyberSentinel. These cookies include session and persistent cookies used to remember your preferences and login information.

Third-Party Cookies: Set by third-party services such as Google Analytics, social media platforms, and advertising networks. These cookies help us track website performance and deliver targeted content.

Session Cookies: These cookies expire when you close your browser and are used to maintain your session and remember your actions during your browsing session.

Persistent Cookies: These cookies remain on your device for a specified period and help us remember information about your preferences across multiple visits.`,
    },
    {
      title: "4. Your Cookie Choices",
      content:
        "Most web browsers allow you to control cookies through their settings. You can set your browser to refuse cookies or notify you when a cookie is being set. However, please note that disabling cookies may affect the functionality of our website and prevent you from accessing certain features.",
    },
    {
      title: "5. Third-Party Services",
      content: `We use third-party services that may use cookies:

• Google Analytics: This service collects data about website traffic and user behavior. For more information, visit Google's Privacy Policy.

• Social Media Platforms: If you connect your social media accounts to our website, cookies may be used to enhance your experience.

• Advertisement Partners: We may use advertising partners who use cookies to deliver targeted ads based on your browsing history.`,
    },
    {
      title: "6. Do Not Track",
      content:
        "Some browsers include a 'Do Not Track' feature. Currently, there is no industry standard for recognizing Do Not Track signals, and CyberSentinel does not respond to Do Not Track browser signals. However, you can use other methods to control cookie usage as described in this policy.",
    },
    {
      title: "7. Changes to Cookie Policy",
      content:
        "CyberSentinel may update this Cookie Policy from time to time to reflect changes in our practices or for other reasons. We encourage you to review this policy periodically to stay informed about how we use cookies.",
    },
    {
      title: "8. Contact Us",
      content:
        "If you have questions about our Cookie Policy or how CyberSentinel uses cookies, please contact us at:\n\nCyberSentinel\nEmail: cookies@cybersentinel.io\nPhone: +1 (555) 123-4567",
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
              Cookie Policy
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

          {/* Key Takeaway */}
          <div className="rounded-[12px] p-8 md:p-12 text-white" style={{ backgroundColor: "#0A5FFF" }}>
            <h2 className="font-heading text-[28px] font-bold mb-4" style={{ letterSpacing: "-1.5px" }}>
              Your Privacy is Protected
            </h2>
            <p className="text-[15px] font-light leading-7" style={{ opacity: 0.9 }}>
              CyberSentinel is committed to protecting your privacy while providing a personalized browsing experience. We use cookies responsibly and transparently. For any specific questions about cookies or our privacy practices, please reach out to our team.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
