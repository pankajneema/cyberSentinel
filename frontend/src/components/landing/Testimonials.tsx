import { Star, Quote } from "lucide-react";
import { motion } from "framer-motion";

const testimonials = [
  {
    quote: "CyberSentinel transformed how we approach security. The unified view of our attack surface and vulnerabilities saves us hours every week.",
    author: "Sarah Chen",
    role: "CISO",
    company: "TechCorp Inc.",
    rating: 5,
  },
  {
    quote: "The automated vulnerability scanning with contextual prioritization is a game-changer. We reduced our remediation time by 60%.",
    author: "Michael Rodriguez",
    role: "Security Engineer",
    company: "FinanceFlow",
    rating: 5,
  },
  {
    quote: "Finally, a platform that brings together ASM and vulnerability scanning without the complexity. Our DevOps team loves it.",
    author: "Emily Watson",
    role: "VP of Engineering",
    company: "CloudScale",
    rating: 5,
  },
];

export function Testimonials() {
  return (
    <section className="py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground mb-4">
            Trusted by <span className="gradient-text">Security Teams</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            See what security professionals say about CyberSentinel
          </p>
        </motion.div>

        {/* Testimonials Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.author}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="card-elevated p-6 relative"
            >
              {/* Quote Icon */}
              <Quote className="absolute top-4 right-4 w-8 h-8 text-primary/10" />

              {/* Rating */}
              <div className="flex gap-1 mb-4">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 text-warning fill-warning" />
                ))}
              </div>

              {/* Quote */}
              <p className="text-foreground mb-6 leading-relaxed">
                "{testimonial.quote}"
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full gradient-bg flex items-center justify-center text-primary-foreground font-semibold">
                  {testimonial.author.charAt(0)}
                </div>
                <div>
                  <div className="font-semibold text-foreground">{testimonial.author}</div>
                  <div className="text-sm text-muted-foreground">
                    {testimonial.role} at {testimonial.company}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
