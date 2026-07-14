// Package ai is the shared home for AI/LLM-backed capabilities in the worker.
// Recon CLIs live under tools/<name>; AI services live here and plug into the
// same pipeline by name. The subdomainprobe subpackage is the first such
// capability (DNS-based AI-subdomain discovery, no LLM call yet); richer
// providers use the Client below.
package ai

import (
	"context"
	"errors"
)

// Provider identifies an LLM backend. Anthropic (Claude) is the default target
// for CyberSentinel's AI capabilities.
type Provider string

const (
	ProviderAnthropic Provider = "anthropic"
)

// Config configures an LLM Client. Values are typically sourced from env/config.
type Config struct {
	Provider Provider
	APIKey   string
	Model    string // e.g. a Claude model id
	BaseURL  string // optional override
}

// Client is a minimal provider-agnostic LLM client used by AI capabilities. It
// is intentionally thin: concrete transport (HTTP call, streaming, tool-use) is
// wired when the first LLM-backed capability lands.
type Client struct {
	cfg Config
}

// ErrNotConfigured is returned when a Client is used without an API key.
var ErrNotConfigured = errors.New("ai: client not configured (missing API key)")

// NewClient builds a Client from cfg.
func NewClient(cfg Config) *Client {
	if cfg.Provider == "" {
		cfg.Provider = ProviderAnthropic
	}
	return &Client{cfg: cfg}
}

// Complete sends a single prompt and returns the model's completion.
//
// TODO: implement the provider transport (Anthropic Messages API). Until then it
// reports ErrNotConfigured so callers degrade gracefully rather than panic.
func (c *Client) Complete(ctx context.Context, prompt string) (string, error) {
	if c.cfg.APIKey == "" {
		return "", ErrNotConfigured
	}
	return "", errors.New("ai: Complete not yet implemented")
}
