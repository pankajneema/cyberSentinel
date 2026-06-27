// Package aisubs performs a dedicated probe for AI/LLM-related subdomains
// (claude.<domain>, openai.<domain>, gemini.<domain>, ...) during domain
// discovery, since these are increasingly common and worth surfacing explicitly.
package aisubs

import (
	"context"
	"net"
	"sync"
	"time"

	"workers/utils"
)

// Curated AI/LLM-related subdomain prefixes to probe explicitly.
var aiPrefixes = []string{
	"claude", "anthropic", "openai", "chatgpt", "gpt", "gpt4", "gpt-4",
	"gemini", "bard", "copilot", "llm", "ai", "ml", "genai", "perplexity",
	"mistral", "cohere", "llama", "huggingface", "chatbot", "assistant",
	"ai-api", "ml-api", "vertex", "bedrock", "azureopenai", "agent", "agents",
}

// Run probes AI-related subdomains of the given domain and returns the FQDNs
// that resolve in DNS. Bounded concurrency with a per-lookup timeout.
func Run(ctx context.Context, domain string) ([]string, error) {
	if domain == "" {
		return []string{}, nil
	}

	const maxConcurrent = 12
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var found []string
	resolver := &net.Resolver{}

	for _, p := range aiPrefixes {
		host := p + "." + domain
		wg.Add(1)
		sem <- struct{}{}
		go func(host string) {
			defer wg.Done()
			defer func() { <-sem }()

			lookupCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
			defer cancel()

			addrs, err := resolver.LookupHost(lookupCtx, host)
			if err == nil && len(addrs) > 0 {
				mu.Lock()
				found = append(found, host)
				mu.Unlock()
			}
		}(host)
	}
	wg.Wait()

	utils.Logger.Infof("ai_subdomain_probe: %d AI/LLM subdomain(s) live for %s", len(found), domain)
	return found, nil
}
