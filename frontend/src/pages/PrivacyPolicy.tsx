import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";

const borderColor = "rgba(15, 40, 80, 0.08)";

export default function PrivacyPolicy() {
  const sections = [
    {
      title: "1. Introduction",
      content:
        "CyberSentinel ('we,' 'us,' 'our,' or 'Company') is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website and use our services.",
    },
    {
      title: "2. Information We Collect",
      content: `We may collect information about you in a variety of ways. The information we may collect on the Site includes:

• Personal Data: Personally identifiable information, such as your name, shipping address, email address, and telephone number, and demographic information, such as your age, gender, hometown, and interests, that you voluntarily give to us when you register with the Site or when you choose to participate in various activities related to the Site.

• Financial Data: Financial information, such as data related to your payment method (e.g., valid credit card number, card brand, expiration date) that we may collect when you purchase or attempt to purchase services from the Site.

• Data From Social Networks: User information from social networks, such as your name, your social network username, location, gender, birth date, email address, profile picture, and public data for contacts if you connect your account to the social network.

• Mobile Device Data: Device information, such as your mobile device ID, model, and manufacturer, and information about the location of your device, if you access the Site from a mobile device.

• Third-Party Data: Information from third parties, such as personal information or network friends, if you connect your account to the third party and authorize us to access this information.`,
    },
    {
      title: "3. Use of Your Information",
      content: `Having accurate information about you permits us to provide you with a smooth, efficient, and customized experience. Specifically, we may use information collected about you via the Site to:

• Email you regarding your account or order
• Fulfill and send orders and receive payments
• Generate a personal profile about you so that future visits to the Site will be personalized
• Improve the Site and services to meet your needs
• Notify you about important changes to the Site or services
• Perform other business activities as needed`,
    },
    {
      title: "4. Disclosure of Your Information",
      content: `We may share information we have collected about you in certain situations:

• By Law or to Protect Rights: If we believe the release of information about you is necessary to comply with the law, enforce our Site policies, or protect our or others' rights, property, and safety.

• Third-Party Service Providers: We may share your information with third parties that perform services for us, including payment processors, data analysis providers, email delivery services, and customer service providers.

• Business Transfers: Your information may be transferred as part of our business assets if we merge with or are acquired by another company.

• With Your Consent: We may disclose your information for any other purpose with your consent.`,
    },
    {
      title: "5. Security of Your Information",
      content:
        "We use administrative, technical, and physical security measures to protect your personal information. While we have implemented safeguards we believe are appropriate, please be aware that no security measures are impenetrable. We cannot guarantee the absolute security of your personal information.",
    },
    {
      title: "6. Contact Us",
      content:
        "If you have questions or comments about this Privacy Policy, please contact us at:\n\nCyberSentinel\nEmail: privacy@cybersentinel.io\nPhone: +1 (555) 123-4567",
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
              Privacy Policy
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

          {/* Additional Info */}
          <div className="rounded-[12px] p-8 md:p-12 text-white" style={{ backgroundColor: "#0A5FFF" }}>
            <h2 className="font-heading text-[28px] font-bold mb-4" style={{ letterSpacing: "-1.5px" }}>
              Your Privacy Matters to Us
            </h2>
            <p className="text-[15px] font-light leading-7" style={{ opacity: 0.9 }}>
              We are committed to protecting your privacy and maintaining the trust you place in us. If you have any questions about our privacy practices or this Privacy Policy, please don't hesitate to contact us. Your data security is our top priority.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
