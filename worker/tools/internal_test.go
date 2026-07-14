package tools

import (
	"context"
	"encoding/base64"
	"fmt"
	"reflect"
	"testing"
	"time"

	"worker/tools/sslscan"
)

// ---------------------------------------------------------------------------
// (a) subdomain enumeration + roots/subdomains/dedupeAppend
// ---------------------------------------------------------------------------

func TestSubdomainEnumRun(t *testing.T) {
	// run injected: per-root return values, one root errors.
	byRoot := map[string]struct {
		subs []string
		err  error
	}{
		"a.com": {subs: []string{"x.a.com", "y.a.com", "x.a.com"}}, // dup within root
		"b.com": {err: fmt.Errorf("boom")},                         // errored root skipped
		"c.com": {subs: []string{"x.a.com", "z.c.com", ""}},        // dup across roots + blank
	}
	tool := subdomainEnum{
		name: "myenum",
		run: func(ctx context.Context, domain string) ([]string, error) {
			r := byRoot[domain]
			return r.subs, r.err
		},
	}
	in := Input{Targets: []string{"a.com", "b.com", "c.com"}}
	out, err := tool.Run(context.Background(), in)
	if err != nil {
		t.Fatalf("Run error: %v", err)
	}
	// Expect x.a.com, y.a.com, z.c.com (deduped across roots, blank/error skipped).
	var got []string
	for _, f := range out.Findings {
		if f.Type != TypeSubdomain {
			t.Errorf("finding type = %q, want %q", f.Type, TypeSubdomain)
		}
		if f.Data["source"] != "myenum" {
			t.Errorf("Data[source] = %v, want myenum", f.Data["source"])
		}
		got = append(got, f.Target)
	}
	want := []string{"x.a.com", "y.a.com", "z.c.com"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("subdomains = %v, want %v", got, want)
	}
	if out.Raw["count"] != len(want) {
		t.Errorf("Raw[count] = %v, want %d", out.Raw["count"], len(want))
	}
}

func TestSubdomainEnumName(t *testing.T) {
	if got := (subdomainEnum{name: "foo"}).Name(); got != "foo" {
		t.Errorf("Name() = %q, want foo", got)
	}
}

func TestRoots(t *testing.T) {
	in := Input{Targets: []string{"a.com", "b.com"}}
	if got := roots(in); !reflect.DeepEqual(got, []string{"a.com", "b.com"}) {
		t.Errorf("roots = %v", got)
	}
}

func TestSubdomains(t *testing.T) {
	in := Input{
		Targets: []string{"a.com", "b.com"},
		Params: map[string]any{"prior_findings": []Finding{
			{Type: TypeSubdomain, Target: "x.a.com"},
			{Type: TypeSubdomain, Target: "x.a.com"}, // dup
			{Type: TypeIP, Target: "1.2.3.4"},        // wrong type ignored
			{Type: TypeSubdomain, Target: "a.com"},   // dup with root
		}},
	}
	got := subdomains(in)
	want := []string{"x.a.com", "a.com", "b.com"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("subdomains = %v, want %v", got, want)
	}
}

func TestDedupeAppend(t *testing.T) {
	tests := []struct {
		name     string
		dst, src []string
		want     []string
	}{
		{"union order preserved", []string{"a", "b"}, []string{"b", "c", "d"}, []string{"a", "b", "c", "d"}},
		{"drops blanks", []string{"a"}, []string{"", "b", ""}, []string{"a", "b"}},
		{"drops dupes in src", []string{"a"}, []string{"a", "a"}, []string{"a"}},
		{"empty src", []string{"a", "b"}, nil, []string{"a", "b"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := dedupeAppend(tt.dst, tt.src); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("dedupeAppend = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSubjects(t *testing.T) {
	in := Input{Params: map[string]any{"prior_findings": []Finding{
		{Type: TypeIP, Target: "1.1.1.1"},
		{Type: TypeIP, Target: "1.1.1.1"}, // dup
		{Type: TypeIP, Target: ""},        // blank skipped
		{Type: TypeIP, Target: "2.2.2.2"},
		{Type: TypeSubdomain, Target: "x"},
	}}}
	if got := Subjects(in, TypeIP); !reflect.DeepEqual(got, []string{"1.1.1.1", "2.2.2.2"}) {
		t.Errorf("Subjects = %v", got)
	}
	if got := Subjects(Input{}, TypeIP); got != nil {
		t.Errorf("Subjects(empty) = %v, want nil", got)
	}
}

// ---------------------------------------------------------------------------
// (b) VS helpers
// ---------------------------------------------------------------------------

func TestVsConfig(t *testing.T) {
	c := map[string]any{"safe_mode": true}
	in := Input{Params: map[string]any{"config": c}}
	if got := vsConfig(in); !reflect.DeepEqual(got, c) {
		t.Errorf("vsConfig = %v", got)
	}
	if got := vsConfig(Input{}); len(got) != 0 {
		t.Errorf("vsConfig(empty) = %v, want empty map", got)
	}
}

func TestVsTargets(t *testing.T) {
	// Structured vs_targets: ports come in as float64 (JSON decode).
	in := Input{
		AssetID: "job-asset",
		Params: map[string]any{"config": map[string]any{
			"vs_targets": []any{
				map[string]any{"asset_id": "a1", "host": "h1", "url": "https://u1", "ports": []any{float64(80), float64(443), float64(0)}},
				map[string]any{"host": "h2"}, // no asset_id -> falls back to job AssetID
				"not-a-map",                  // skipped
			},
		}},
	}
	got := vsTargets(in)
	if len(got) != 2 {
		t.Fatalf("len(vsTargets) = %d, want 2", len(got))
	}
	if got[0].AssetID != "a1" || got[0].Host != "h1" || got[0].URL != "https://u1" {
		t.Errorf("target0 = %+v", got[0])
	}
	if !reflect.DeepEqual(got[0].Ports, []int{80, 443}) { // 0 dropped
		t.Errorf("target0.Ports = %v, want [80 443]", got[0].Ports)
	}
	if got[1].AssetID != "job-asset" {
		t.Errorf("target1.AssetID = %q, want job-asset", got[1].AssetID)
	}
}

func TestVsTargetsFallback(t *testing.T) {
	// No vs_targets key -> plain string targets under job asset.
	in := Input{AssetID: "ja", Targets: []string{"h1", "h2"}}
	got := vsTargets(in)
	if len(got) != 2 || got[0].Host != "h1" || got[0].AssetID != "ja" {
		t.Errorf("fallback vsTargets = %+v", got)
	}
}

func TestVsProfileOf(t *testing.T) {
	in := Input{Params: map[string]any{"config": map[string]any{
		"safe_mode": true, "max_requests_per_sec": float64(25),
	}}}
	p := vsProfileOf(in)
	if !p.SafeMode || p.MaxRPS != 25 {
		t.Errorf("vsProfileOf = %+v", p)
	}
}

func TestAuthHeaders(t *testing.T) {
	if authHeaders(nil) != nil {
		t.Error("authHeaders(nil) should be nil")
	}
	if got := authHeaders(&Credential{Type: "bearer", Secret: "tok"}); !reflect.DeepEqual(got, []string{"Authorization: Bearer tok"}) {
		t.Errorf("bearer = %v", got)
	}
	if got := authHeaders(&Credential{Type: "bearer", Secret: ""}); got != nil {
		t.Errorf("bearer empty secret = %v, want nil", got)
	}
	basic := authHeaders(&Credential{Type: "http_basic", Username: "u", Secret: "p"})
	want := "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte("u:p"))
	if !reflect.DeepEqual(basic, []string{want}) {
		t.Errorf("http_basic = %v, want %v", basic, want)
	}
	if got := authHeaders(&Credential{Type: "http_basic", Secret: ""}); got != nil {
		t.Errorf("http_basic empty secret = %v", got)
	}
	if got := authHeaders(&Credential{Type: "weird"}); got != nil {
		t.Errorf("unknown type = %v, want nil", got)
	}
}

func TestNormalizeSeverity(t *testing.T) {
	tests := map[string]string{"": "info", "  HIGH ": "high", "Critical": "critical"}
	for in, want := range tests {
		if got := normalizeSeverity(in); got != want {
			t.Errorf("normalizeSeverity(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFloorSeverity(t *testing.T) {
	tests := []struct {
		sev, floor, want string
	}{
		{"low", "high", "high"},          // below floor -> raised
		{"critical", "high", "critical"}, // above floor -> kept
		{"high", "high", "high"},         // equal
		{"unknown", "medium", "medium"},  // unranked -> floor
	}
	for _, tt := range tests {
		if got := floorSeverity(tt.sev, tt.floor); got != tt.want {
			t.Errorf("floorSeverity(%q,%q) = %q, want %q", tt.sev, tt.floor, got, tt.want)
		}
	}
}

func TestDeriveCategory(t *testing.T) {
	if got := deriveCategory([]string{"CVE-2021-1"}, nil); got != "cve_match" {
		t.Errorf("cve -> %q", got)
	}
	if got := deriveCategory(nil, []string{"misconfig"}); got != "misconfig" {
		t.Errorf("misconfig -> %q", got)
	}
	if got := deriveCategory(nil, []string{"Exposure"}); got != "exposure" {
		t.Errorf("exposure -> %q", got)
	}
	if got := deriveCategory(nil, []string{"random"}); got != "exposure" {
		t.Errorf("default -> %q", got)
	}
}

func TestNormalizeCVEs(t *testing.T) {
	got := normalizeCVEs([]string{" cve-2021-1 ", "", "cve-2022-2"})
	if !reflect.DeepEqual(got, []string{"CVE-2021-1", "CVE-2022-2"}) {
		t.Errorf("normalizeCVEs = %v", got)
	}
	if got := normalizeCVEs(nil); len(got) != 0 {
		t.Errorf("normalizeCVEs(nil) = %v, want empty", got)
	}
}

func TestBuildEvidence(t *testing.T) {
	if got := buildEvidence("m", []string{"a", "b"}); got != "matcher=m; extracted=a, b" {
		t.Errorf("buildEvidence full = %q", got)
	}
	if got := buildEvidence("", nil); got != "" {
		t.Errorf("buildEvidence empty = %q", got)
	}
	if got := buildEvidence("m", nil); got != "matcher=m" {
		t.Errorf("buildEvidence matcher-only = %q", got)
	}
}

func TestSlugifyService(t *testing.T) {
	tests := map[string]string{"": "unknown", "  ": "unknown", "HTTP": "http", "ms-sql/2": "ms-sql-2"}
	for in, want := range tests {
		if got := slugifyService(in); got != want {
			t.Errorf("slugifyService(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseCertDate(t *testing.T) {
	if ts, ok := parseCertDate("Jan 2 15:04:05 2006 GMT"); !ok || ts.Year() != 2006 {
		t.Errorf("valid parse failed: %v %v", ts, ok)
	}
	if ts, ok := parseCertDate("2021-06-15 12:00:00"); !ok || ts.Year() != 2021 {
		t.Errorf("valid parse2 failed: %v %v", ts, ok)
	}
	if _, ok := parseCertDate("nonsense"); ok {
		t.Error("invalid date parsed ok")
	}
}

func TestMapTLSResult(t *testing.T) {
	past := time.Now().AddDate(-1, 0, 0).Format("2006-01-02 15:04:05")

	t.Run("expired", func(t *testing.T) {
		r := sslscan.SSLResult{Host: "h", Port: 443, ValidUntil: past}
		out := mapTLSResult("a1", "sslyze", r)
		if !hasPlugin(out, "tls-cert-expired") {
			t.Errorf("expected expired finding, got %v", plugins(out))
		}
	})
	t.Run("not-expired future", func(t *testing.T) {
		future := time.Now().AddDate(1, 0, 0).Format("2006-01-02 15:04:05")
		out := mapTLSResult("a1", "sslyze", sslscan.SSLResult{ValidUntil: future})
		if hasPlugin(out, "tls-cert-expired") {
			t.Error("future cert should not be expired")
		}
	})
	t.Run("self-signed", func(t *testing.T) {
		r := sslscan.SSLResult{Certificate: "CN=x", Issuer: "cn=x"} // EqualFold
		out := mapTLSResult("a1", "sslyze", r)
		if !hasPlugin(out, "tls-cert-self-signed") {
			t.Errorf("expected self-signed, got %v", plugins(out))
		}
	})
	t.Run("weak cipher rc4", func(t *testing.T) {
		r := sslscan.SSLResult{Cipher: "ECDHE-RC4-SHA"}
		out := mapTLSResult("a1", "sslyze", r)
		if !hasPlugin(out, "tls-weak-cipher-rc4") {
			t.Errorf("expected rc4 weak cipher, got %v", plugins(out))
		}
	})
	t.Run("clean cert no findings", func(t *testing.T) {
		r := sslscan.SSLResult{Certificate: "CN=a", Issuer: "CN=b", Protocol: "TLSv1.3", Cipher: "AES256-GCM"}
		if out := mapTLSResult("a1", "sslyze", r); len(out) != 0 {
			t.Errorf("clean cert produced %v", plugins(out))
		}
	})
}

func hasPlugin(rfs []map[string]any, id string) bool {
	for _, rf := range rfs {
		if rf["plugin_id"] == id {
			return true
		}
	}
	return false
}

func plugins(rfs []map[string]any) []any {
	var out []any
	for _, rf := range rfs {
		out = append(out, rf["plugin_id"])
	}
	return out
}

func TestToInt(t *testing.T) {
	tests := []struct {
		in   any
		want int
	}{
		{float64(3.9), 3}, {int(5), 5}, {int64(7), 7}, {"nope", 0}, {nil, 0},
	}
	for _, tt := range tests {
		if got := toInt(tt.in); got != tt.want {
			t.Errorf("toInt(%v) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

func TestToBool(t *testing.T) {
	if !toBool(true) || toBool(false) || toBool("true") || toBool(nil) {
		t.Error("toBool mismatch")
	}
}

func TestFirstNonEmpty(t *testing.T) {
	if got := firstNonEmpty("a", "b"); got != "a" {
		t.Errorf("firstNonEmpty(a,b) = %q", got)
	}
	if got := firstNonEmpty("  ", "b"); got != "b" {
		t.Errorf("firstNonEmpty(blank,b) = %q", got)
	}
}

// ---------------------------------------------------------------------------
// (c) SSRF guards + CIDR expanders — security critical
// ---------------------------------------------------------------------------

// forbiddenCases: addresses that MUST be forbidden by every guard.
var forbiddenCases = []string{
	"127.0.0.1",       // loopback
	"10.0.0.1",        // RFC1918
	"192.168.1.1",     // RFC1918
	"172.16.0.1",      // RFC1918
	"169.254.169.254", // link-local / cloud metadata
	"not-an-ip",       // unparseable
}

func TestSSRFGuards(t *testing.T) {
	guards := map[string]func(string) bool{
		"isForbiddenScanIPv2":     isForbiddenScanIPv2,
		"forbiddenScanIPSvc":      forbiddenScanIPSvc,
		"isForbiddenScanIPEnrich": isForbiddenScanIPEnrich,
	}
	for name, guard := range guards {
		t.Run(name, func(t *testing.T) {
			for _, bad := range forbiddenCases {
				if !guard(bad) {
					t.Errorf("%s(%q) = false, want forbidden", name, bad)
				}
			}
			if guard("8.8.8.8") {
				t.Errorf("%s(8.8.8.8) = true, want allowed", name)
			}
		})
	}
}

func TestCIDRExpanders(t *testing.T) {
	expanders := map[string]func(string, int) []string{
		"expandCIDRv2":     expandCIDRv2,
		"expandCIDRSvc":    expandCIDRSvc,
		"expandCIDREnrich": expandCIDREnrich,
	}
	for name, exp := range expanders {
		t.Run(name, func(t *testing.T) {
			// /30 IPv4 -> 4 addresses.
			if got := exp("192.0.2.0/30", 4096); len(got) != 4 {
				t.Errorf("%s(/30) = %d addrs, want 4 (%v)", name, len(got), got)
			}
			// Huge prefix is bounded to the cap.
			if got := exp("10.0.0.0/8", 4096); len(got) != 4096 {
				t.Errorf("%s(/8) = %d addrs, want bounded 4096", name, len(got))
			}
			// Invalid CIDR -> nil.
			if got := exp("nonsense", 4096); got != nil {
				t.Errorf("%s(nonsense) = %v, want nil", name, got)
			}
		})
	}
}
