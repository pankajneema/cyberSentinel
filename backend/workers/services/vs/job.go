package vs

// ---- VS job data types ----

// Target is a single host/URL to scan, optionally with known open ports from a
// prior ASM/port-scan stage.
type Target struct {
	AssetID string `json:"asset_id"`
	Host    string `json:"host"`
	URL     string `json:"url,omitempty"`
	Ports   []int  `json:"ports,omitempty"`
}

// Credential is an authenticated-scan secret resolved just-in-time for a job.
//
// SECURITY: instances hold a decrypted secret in memory only. This type has NO
// json tags and MUST NEVER be placed on any struct that is serialized into a
// log line or the report.vs payload. Adapters read it to build auth headers and
// discard it when the scan ends.
type Credential struct {
	Type     string // http_basic | http_form | ssh | bearer
	Username string
	Secret   string
}

// Profile controls how aggressively the scan runs and which engines participate.
type Profile struct {
	Engines  []string `json:"engines"`
	SafeMode bool     `json:"safe_mode"`
	MaxRPS   int      `json:"max_requests_per_sec"`
	WebScan  bool     `json:"web_scan"`

	// Credential, when non-nil, carries an authenticated-scan secret for
	// adapters to apply (e.g. as an Authorization header). It is intentionally
	// unexported to JSON (no tag serialization occurs because Profile is never
	// marshaled with the secret set) and must never be logged. See Credential.
	Credential *Credential `json:"-"`
}

// RawFinding is the normalized, engine-agnostic finding emitted by every
// scanner. The reporting consumer persists these; field names match the
// report.vs JSON contract.
type RawFinding struct {
	AssetID      string         `json:"asset_id"`
	SourceEngine string         `json:"source_engine"`
	PluginID     string         `json:"plugin_id"`
	Title        string         `json:"title"`
	Description  string         `json:"description"`
	Category     string         `json:"category"`
	Severity     string         `json:"severity"`
	Evidence     string         `json:"evidence"`
	Confidence   string         `json:"confidence"`
	CVEs         []string       `json:"cve_ids"`
	CVSSBase     float64        `json:"cvss_base"`
	Location     map[string]any `json:"location"`
}
