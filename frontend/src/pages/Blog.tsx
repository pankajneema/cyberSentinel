import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const borderColor = "rgba(15, 40, 80, 0.08)";

const blogPosts = [];

export default function Blog() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = Array.from(new Set(blogPosts.map((post) => post.category)));

  const filteredPosts = blogPosts.filter((post) => {
    const matchesSearch =
      post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.excerpt.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = !selectedCategory || post.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F8FAFC" }}>
      <Navbar />

      <main className="pt-24 pb-24">
        <div className="mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
          {/* Hero */}
          <div className="max-w-3xl mx-auto mb-12">
            <h1 className="font-heading text-[44px] sm:text-[52px] font-extrabold leading-[1.02] text-[#0D1B2A] mb-6" style={{ letterSpacing: "-1.5px" }}>
              Security <span style={{ color: "#0A5FFF" }}>Insights</span>
            </h1>
            <p className="text-[15px] font-light leading-7 text-[#5A7184]">
              Expert analysis, best practices, and industry trends from the CyberSentinel team.
            </p>
          </div>

          {/* Search and Filters */}
          <div className="max-w-2xl mx-auto mb-12">
            <div className="relative mb-6">
              <input
                type="text"
                placeholder="Search articles..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-3 bg-white border rounded-[12px] text-[#0D1B2A] placeholder-text-[#A0B4C4] focus:outline-none transition-colors"
                style={{ borderColor, backgroundColor: "#FFFFFF" }}
              />
            </div>

            {/* Category Filters */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory(null)}
                className="px-4 py-2 rounded-full text-[13px] font-medium transition-colors"
                style={{
                  backgroundColor: selectedCategory === null ? "#0A5FFF" : "white",
                  color: selectedCategory === null ? "white" : "#0D1B2A",
                  border: selectedCategory === null ? "none" : `1px solid ${borderColor}`,
                }}
              >
                All Posts
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className="px-4 py-2 rounded-full text-[13px] font-medium transition-colors"
                  style={{
                    backgroundColor: selectedCategory === category ? "#0A5FFF" : "white",
                    color: selectedCategory === category ? "white" : "#0D1B2A",
                    border: selectedCategory === category ? "none" : `1px solid ${borderColor}`,
                  }}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          {/* Blog Posts Grid */}
          <div className="space-y-6 max-w-3xl mx-auto mb-20">
            {filteredPosts.length > 0 ? (
              filteredPosts.map((post, index) => (
                <div
                  key={post.id}
                  className="bg-white border rounded-[12px] p-6 md:p-8 transition-colors"
                  style={{ borderColor }}
                >
                  <div className="flex gap-6">
                    <div className="text-4xl h-16 w-16 flex items-center justify-center flex-shrink-0">
                      {post.image}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="mb-3">
                        <span className="inline-block px-3 py-1 text-[11px] font-medium rounded-full uppercase tracking-[1.5px]" style={{ color: "#0A5FFF", backgroundColor: "rgba(10, 95, 255, 0.08)" }}>
                          {post.category}
                        </span>
                      </div>
                      <h2 className="font-heading text-[18px] md:text-[20px] font-semibold text-[#0D1B2A] mb-3" style={{ letterSpacing: "-1px" }}>
                        {post.title}
                      </h2>
                      <p className="text-[15px] font-light leading-7 text-[#5A7184] mb-4">{post.excerpt}</p>
                      <div className="flex flex-wrap items-center gap-4 text-[13px] text-[#5A7184] mb-4">
                        <span>{post.author}</span>
                        <span>{post.date}</span>
                        <span>{post.readTime}</span>
                      </div>
                      <Button
                        className="h-10 px-4 text-[13px] font-normal shadow-none rounded-[8px] transition-colors"
                        style={{ backgroundColor: "#0A5FFF", color: "white", border: "none" }}
                        asChild
                      >
                        <a href={`/blog/${post.id}`}>Read Article</a>
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12">
                <p className="text-[15px] text-[#5A7184]">No articles found matching your search.</p>
              </div>
            )}
          </div>

          {/* Newsletter CTA */}
          <div className="rounded-[12px] p-8 md:p-12 text-center max-w-2xl mx-auto" style={{ backgroundColor: "#0A5FFF" }}>
            <h2 className="font-heading text-[28px] md:text-[32px] font-bold text-white mb-4" style={{ letterSpacing: "-1.5px" }}>
              Stay Updated
            </h2>
            <p className="text-[15px] font-light leading-7 text-white mb-6" style={{ opacity: 0.9 }}>
              Get the latest security insights and platform updates delivered to your inbox.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                placeholder="Your email"
                className="flex-1 px-4 py-3 bg-white rounded-[8px] text-[#0D1B2A] placeholder-text-[#A0B4C4] focus:outline-none transition-colors"
              />
              <Button className="h-11 px-6 text-[15px] font-normal shadow-none rounded-[8px] transition-colors" style={{ backgroundColor: "white", color: "#0A5FFF", border: "none" }}>
                Subscribe
              </Button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
