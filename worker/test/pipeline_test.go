package test

// Black-box tests for the scan worker's public pipeline API: cross-language
// contract helpers, the tool registry, service stage resolution (via the blank
// import that self-registers asm/vs/ca), prior-finding chaining, and Job JSON
// decoding. Only exported symbols are touched.

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"

	"worker/core"
	"worker/tools"

	_ "worker/services"
)

// ---- (1) contract helpers ----

func TestQueuesFor(t *testing.T) {
	cases := []struct {
		service string
		want    []string
	}{
		{"asm", []string{"asm.high", "asm.medium", "asm.low"}},
		{"vs", []string{"vs.high", "vs.medium", "vs.low"}},
		{"ca", []string{"ca.high", "ca.medium", "ca.low"}},
	}
	for _, c := range cases {
		got := core.QueuesFor(c.service)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("QueuesFor(%q) = %v, want %v", c.service, got, c.want)
		}
	}
}

func TestRedisKeySchema(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"SlotsKey", core.SlotsKey("asm"), "slots:asm"},
		{"TaskKey", core.TaskKey("t1"), "task:t1"},
		{"CancelKey", core.CancelKey("t1"), "task:t1:cancel"},
		{"LeaseKey", core.LeaseKey("t1"), "task:t1:lease"},
		{"EventsChannel", core.EventsChannel("org9"), "task_events:org9"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s = %q, want %q", c.name, c.got, c.want)
		}
	}
}

func TestReportingQueue(t *testing.T) {
	for svc, want := range map[string]string{"asm": "reporting.asm", "vs": "reporting.vs", "ca": "reporting.ca"} {
		if got := core.ReportingQueueFor(svc); got != want {
			t.Errorf("ReportingQueueFor(%q) = %q, want %q", svc, got, want)
		}
	}
}

// ---- (2) registry completeness ----

func TestRegistryHasEveryPipelineTool(t *testing.T) {
	names := []string{
		// domain chain
		"subfinder", "crtsh", "ai_subdomain_probe", "amass", "bbot",
		"dnsgen", "dnsx", "ip_mapping", "http_probe", "httpx", "nuclei",
		// wrapper-backed
		"top_ports_scanner", "service_detector", "nmap", "ssl_analyzer",
		"admin_finder", "cloud_osint", "public_endpoint_detect",
		"email_leak_check", "repo_secret_scan", "saas_detect",
		// ip_* family
		"ip_target_seed", "ip_alive_check", "ip_port_scan_light",
		"ip_port_scan_normal", "ip_port_scan_deep",
		"ip_service_fingerprint_normal", "ip_http_probe_light", "ip_tls_deep",
		"ip_whois_rdap", "ip_exposure_score",
		// enrichers
		"ipinfo", "asnmap", "api_detector", "http_banner_check",
		// vs + ca
		"vs_nuclei", "vs_sslyze", "vs_nmap_nse", "vs_default_login", "ca_evaluate",
	}
	for _, n := range names {
		if _, ok := tools.Get(n); !ok {
			t.Errorf("tools.Get(%q): not registered", n)
		}
	}
}

func TestRegistryUnknownTool(t *testing.T) {
	if _, ok := tools.Get("nope"); ok {
		t.Errorf("tools.Get(\"nope\") = ok, want not ok")
	}
}

func TestRegistryNamesSortedNoDupes(t *testing.T) {
	names := tools.Names()
	if len(names) == 0 {
		t.Fatal("tools.Names() is empty")
	}
	if !sort.StringsAreSorted(names) {
		t.Errorf("tools.Names() not sorted: %v", names)
	}
	seen := map[string]bool{}
	for _, n := range names {
		if seen[n] {
			t.Errorf("tools.Names() has duplicate %q", n)
		}
		seen[n] = true
	}
}

// ---- (3) service stages via core.ServiceFor ----

func domainJob() core.Job {
	return core.Job{Mode: core.ModeLight, Config: map[string]any{"asset_type": "domain"}}
}

func TestASMLightStages(t *testing.T) {
	svc, ok := core.ServiceFor("asm")
	if !ok {
		t.Fatal("ServiceFor(\"asm\") not registered")
	}
	stages := svc.Stages(domainJob())
	if len(stages) != 6 {
		t.Fatalf("asm LIGHT domain: got %d stages, want 6", len(stages))
	}
	if stages[0].Name != "subdomain_discovery" || stages[0].Tool != "subfinder" {
		t.Errorf("first stage = {%q,%q}, want {subdomain_discovery,subfinder}", stages[0].Name, stages[0].Tool)
	}
}

func TestASMStagesCopySemantics(t *testing.T) {
	svc, _ := core.ServiceFor("asm")
	first := svc.Stages(domainJob())
	origName := first[0].Name
	first[0].Name = "MUTATED"
	first[0].Tool = "MUTATED"
	second := svc.Stages(domainJob())
	if second[0].Name != origName {
		t.Errorf("Stages did not return a copy: second[0].Name = %q, want %q", second[0].Name, origName)
	}
}

func TestVSDefaultStages(t *testing.T) {
	svc, ok := core.ServiceFor("vs")
	if !ok {
		t.Fatal("ServiceFor(\"vs\") not registered")
	}
	// Config with engines omitted → default full set of 4 vs_* stages.
	stages := svc.Stages(core.Job{Mode: core.ModeNormal, Config: map[string]any{}})
	if len(stages) != 4 {
		t.Fatalf("vs default: got %d stages, want 4", len(stages))
	}
	for _, s := range stages {
		if len(s.Tool) < 3 || s.Tool[:3] != "vs_" {
			t.Errorf("vs stage tool %q is not a vs_* tool", s.Tool)
		}
		if _, ok := tools.Get(s.Tool); !ok {
			t.Errorf("vs stage tool %q not registered", s.Tool)
		}
	}
}

func TestCAStages(t *testing.T) {
	svc, ok := core.ServiceFor("ca")
	if !ok {
		t.Fatal("ServiceFor(\"ca\") not registered")
	}
	stages := svc.Stages(core.Job{})
	if len(stages) != 1 {
		t.Fatalf("ca: got %d stages, want 1", len(stages))
	}
	if stages[0].Name != "compliance_evaluation" || stages[0].Tool != "ca_evaluate" {
		t.Errorf("ca stage = {%q,%q}, want {compliance_evaluation,ca_evaluate}", stages[0].Name, stages[0].Tool)
	}
}

func TestServiceIdentity(t *testing.T) {
	cases := []struct {
		id     string
		queues []string
	}{
		{"asm", []string{"asm.high", "asm.medium", "asm.low"}},
		{"vs", []string{"vs.high", "vs.medium", "vs.low"}},
		{"ca", []string{"ca.high", "ca.medium", "ca.low"}},
	}
	for _, c := range cases {
		svc, ok := core.ServiceFor(c.id)
		if !ok {
			t.Fatalf("ServiceFor(%q) not registered", c.id)
		}
		if svc.Name() != c.id {
			t.Errorf("%s Name() = %q, want %q", c.id, svc.Name(), c.id)
		}
		if !reflect.DeepEqual(svc.Queues(), c.queues) {
			t.Errorf("%s Queues() = %v, want %v", c.id, svc.Queues(), c.queues)
		}
	}
}

// ---- (4) prior-finding chaining via exported helpers ----

func TestPriorFindingsAndSubjects(t *testing.T) {
	findings := []tools.Finding{
		{Type: tools.TypeSubdomain, Target: "a.example.com"},
		{Type: tools.TypeSubdomain, Target: "b.example.com"},
		{Type: tools.TypeSubdomain, Target: "a.example.com"}, // dup
		{Type: tools.TypeIP, Target: "1.2.3.4"},
		{Type: tools.TypeSubdomain, Target: ""}, // empty target dropped
	}
	in := tools.Input{Params: map[string]any{"prior_findings": findings}}

	got := tools.PriorFindings(in)
	if len(got) != len(findings) {
		t.Errorf("PriorFindings len = %d, want %d", len(got), len(findings))
	}

	subs := tools.Subjects(in, tools.TypeSubdomain)
	want := []string{"a.example.com", "b.example.com"}
	if !reflect.DeepEqual(subs, want) {
		t.Errorf("Subjects(subdomain) = %v, want %v", subs, want)
	}

	if ips := tools.Subjects(in, tools.TypeIP); !reflect.DeepEqual(ips, []string{"1.2.3.4"}) {
		t.Errorf("Subjects(ip) = %v, want [1.2.3.4]", ips)
	}
}

func TestPriorFindingsEmpty(t *testing.T) {
	if got := tools.PriorFindings(tools.Input{}); got != nil {
		t.Errorf("PriorFindings(empty) = %v, want nil", got)
	}
	if got := tools.Subjects(tools.Input{}, tools.TypeSubdomain); got != nil {
		t.Errorf("Subjects(empty) = %v, want nil", got)
	}
}

// ---- (5) Job JSON unmarshal: asset_id null → "" ----

func TestJobUnmarshalNullAssetID(t *testing.T) {
	msg := []byte(`{"type":"asm","priority":"high","task_id":"t1","org_id":"o1","asset_id":null,"targets":["example.com"],"mode":"LIGHT","config":{}}`)
	var job core.Job
	if err := json.Unmarshal(msg, &job); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if job.AssetID != "" {
		t.Errorf("AssetID = %q, want empty string", job.AssetID)
	}
	if job.Type != "asm" || job.TaskID != "t1" {
		t.Errorf("decoded job = %+v", job)
	}
}
