// Package saasdetect identifies third-party SaaS applications used by a domain
// by inspecting MX records and resolving common SaaS-related subdomains.
package saasdetect

import (
	"context"
	"net"
	"strings"
	"sync"
	"time"

	"worker/utils"
)

// App represents a detected third-party SaaS application.
type App struct {
	AppName         string `json:"app_name"`
	Vendor          string `json:"vendor"`
	Category        string `json:"category"`
	URL             string `json:"url"`
	Status          string `json:"status"`
	DiscoveryMethod string `json:"discovery_method"`
}

// mxIndicator maps an MX hostname substring to a SaaS app.
type mxIndicator struct {
	match    string
	appName  string
	vendor   string
	category string
}

var mxIndicators = []mxIndicator{
	{"aspmx.l.google.com", "Google Workspace", "Google", "Productivity"},
	{"googlemail.com", "Google Workspace", "Google", "Productivity"},
	{"mail.protection.outlook.com", "Microsoft 365", "Microsoft", "Productivity"},
	{"pphosted.com", "Proofpoint", "Proofpoint", "Email Security"},
	{"mimecast.com", "Mimecast", "Mimecast", "Email Security"},
	{"messagelabs.com", "Symantec Email", "Broadcom", "Email Security"},
	{"zoho.com", "Zoho Mail", "Zoho", "Productivity"},
}

// subIndicator maps a subdomain prefix to a SaaS app.
type subIndicator struct {
	prefix   string
	appName  string
	vendor   string
	category string
}

var subIndicators = []subIndicator{
	{"sso", "Single Sign-On", "Unknown", "Identity"},
	{"okta", "Okta", "Okta", "Identity"},
	{"atlassian", "Atlassian", "Atlassian", "Collaboration"},
	{"jira", "Jira", "Atlassian", "Collaboration"},
	{"confluence", "Confluence", "Atlassian", "Collaboration"},
	{"slack", "Slack", "Salesforce", "Collaboration"},
	{"zendesk", "Zendesk", "Zendesk", "Support"},
	{"salesforce", "Salesforce", "Salesforce", "CRM"},
	{"workday", "Workday", "Workday", "HR"},
	{"servicenow", "ServiceNow", "ServiceNow", "ITSM"},
	{"hubspot", "HubSpot", "HubSpot", "Marketing"},
	{"zoom", "Zoom", "Zoom", "Collaboration"},
	{"box", "Box", "Box", "Storage"},
	{"dropbox", "Dropbox", "Dropbox", "Storage"},
}

// Run detects SaaS apps for the given domain via MX and DNS subdomain checks.
func Run(ctx context.Context, domain string) ([]map[string]interface{}, error) {
	if domain == "" {
		return []map[string]interface{}{}, nil
	}

	resolver := &net.Resolver{}
	var mu sync.Mutex
	seen := map[string]bool{}
	apps := make([]map[string]interface{}, 0)

	add := func(a App) {
		mu.Lock()
		defer mu.Unlock()
		if seen[a.AppName] {
			return
		}
		seen[a.AppName] = true
		apps = append(apps, map[string]interface{}{
			"app_name":         a.AppName,
			"vendor":           a.Vendor,
			"category":         a.Category,
			"url":              a.URL,
			"status":           "detected",
			"discovery_method": a.DiscoveryMethod,
		})
	}

	// MX-based detection.
	mxCtx, mxCancel := context.WithTimeout(ctx, 5*time.Second)
	mxs, err := resolver.LookupMX(mxCtx, domain)
	mxCancel()
	if err != nil {
		utils.Logger.Warnf("saas_detect: MX lookup failed domain=%s err=%v", domain, err)
	}
	for _, mx := range mxs {
		host := strings.ToLower(strings.TrimSuffix(mx.Host, "."))
		for _, ind := range mxIndicators {
			if strings.Contains(host, ind.match) {
				add(App{
					AppName:         ind.appName,
					Vendor:          ind.vendor,
					Category:        ind.category,
					URL:             host,
					DiscoveryMethod: "mx",
				})
			}
		}
	}

	// DNS subdomain-based detection (bounded concurrency).
	const maxConcurrent = 12
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup
	for _, ind := range subIndicators {
		host := ind.prefix + "." + domain
		wg.Add(1)
		sem <- struct{}{}
		go func(ind subIndicator, host string) {
			defer wg.Done()
			defer func() { <-sem }()

			lookupCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
			defer cancel()
			addrs, lerr := resolver.LookupHost(lookupCtx, host)
			if lerr == nil && len(addrs) > 0 {
				add(App{
					AppName:         ind.appName,
					Vendor:          ind.vendor,
					Category:        ind.category,
					URL:             host,
					DiscoveryMethod: "dns",
				})
			}
		}(ind, host)
	}
	wg.Wait()

	utils.Logger.Infof("saas_detect: %d SaaS app(s) detected for %s", len(apps), domain)
	return apps, nil
}
