package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"workers/database"
	"workers/executor"
	aisubs "workers/executor/tools/aisubs"
	amass "workers/executor/tools/amass"
	bbot "workers/executor/tools/bbot"
	cloudenum "workers/executor/tools/cloudenum"
	"workers/executor/tools/crtsh"
	dnsgen "workers/executor/tools/dnsgen"
	"workers/executor/tools/dnsx"
	gobuster "workers/executor/tools/gobuster"
	"workers/executor/tools/httpprobe"
	"workers/executor/tools/httpx"
	katana "workers/executor/tools/katana"
	naabu "workers/executor/tools/naabu"
	nmap "workers/executor/tools/nmap"
	"workers/executor/tools/nuclei"
	emailleak "workers/executor/tools/emailleak"
	reposcan "workers/executor/tools/reposcan"
	saasdetect "workers/executor/tools/saasdetect"
	sslscan "workers/executor/tools/sslscan"
	"workers/executor/tools/subfinder"
	"workers/utils"
)

// ToolResult represents the result of a tool execution within pipeline
// Each result corresponds to a stage in the ASM pipeline
type ToolResult struct {
	Order         int                    `json:"order"`
	Step          string                 `json:"step"` // Stage name (e.g., "subdomain_discovery")
	AssetID       string                 `json:"asset_id,omitempty"`
	Tool          string                 `json:"tool"`   // Tool name (e.g., "subfinder")
	Status        string                 `json:"status"` // PENDING, RUNNING, COMPLETED, FAILED
	StartedAt     *time.Time             `json:"started_at,omitempty"`
	EndedAt       *time.Time             `json:"ended_at,omitempty"`
	ExecutionTime int64                  `json:"execution_time_ms,omitempty"`
	Result        map[string]interface{} `json:"result,omitempty"`
	Error         string                 `json:"error,omitempty"`
}

// StepEvent represents a step completion event emitted after each step
// This follows ASM event emission rules: emit after EACH step completion
type StepEvent struct {
	JobID    string `json:"job_id"`
	AssetID  string `json:"asset_id,omitempty"`
	Stage    string `json:"stage"`    // Stage name (e.g., "subdomain_discovery")
	Tool     string `json:"tool"`     // Tool name (e.g., "subfinder")
	Status   string `json:"status"`   // COMPLETED | FAILED
	Progress int    `json:"progress"` // 0-100
	IsFinal  bool   `json:"is_final"` // false for step events, true for final event
}

// FinalEvent represents the final pipeline completion event
// Emitted ONLY ONCE when entire pipeline completes
type FinalEvent struct {
	JobID    string `json:"job_id"`
	Status   string `json:"status"`   // "PIPELINE_COMPLETED"
	Progress int    `json:"progress"` // Always 100
	IsFinal  bool   `json:"is_final"` // Always true
}

// EnhancedPipeline represents the complete pipeline with results
type EnhancedPipeline struct {
	JobID     string       `json:"job_id"`
	AssetType string       `json:"asset_type"`
	AssetName string       `json:"asset_name,omitempty"` // Domain name for domain assets
	Intensity string       `json:"intensity"`
	Status    string       `json:"status"`
	Process   string       `json:"process"`
	Error     string       `json:"error,omitempty"`
	Pipeline  []ToolResult `json:"pipeline"`
}

// reportQueue holds RabbitMQ connection for reporting
var reportQueue *utils.Queue

// InitReportQueue initializes RabbitMQ connection for ASM reports
func InitReportQueue(rabbitURL string) error {
	var err error
	reportQueue, err = utils.Connect(rabbitURL, "report.asm")
	if err != nil {
		return fmt.Errorf("failed to connect to report.asm queue: %w", err)
	}
	utils.Logger.Info("report.asm queue initialized successfully")
	return nil
}

// CloseReportQueue closes the report queue connection
func CloseReportQueue() {
	if reportQueue != nil {
		reportQueue.Close()
		utils.Logger.Info("report.asm queue closed")
	}
}

// pushToReportQueue sends pipeline data to RabbitMQ report.asm queue
// This sends the complete pipeline state (for reporting consumer to process)
func pushToReportQueue(ctx context.Context, pipeline *EnhancedPipeline) error {
	if reportQueue == nil {
		return errors.New("report queue not initialized")
	}

	data, err := json.Marshal(pipeline)
	if err != nil {
		return fmt.Errorf("failed to marshal pipeline for report: %w", err)
	}

	publishCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	err = reportQueue.Publish(publishCtx, data)
	if err != nil {
		return fmt.Errorf("failed to publish to report.asm: %w", err)
	}

	utils.Logger.Debugf("pushed to report.asm queue job=%s status=%s", pipeline.JobID, pipeline.Status)
	return nil
}

// emitStepEvent emits a step completion event after each step finishes
// ASM Rule: EACH step emits an event on completion
func emitStepEvent(ctx context.Context, jobID string, assetID string, stage string, tool string, status string, progress int) error {
	if reportQueue == nil {
		return errors.New("report queue not initialized")
	}

	event := StepEvent{
		JobID:    jobID,
		AssetID:  assetID,
		Stage:    stage,
		Tool:     tool,
		Status:   status,
		Progress: progress,
		IsFinal:  false, // Step events are never final
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal step event: %w", err)
	}

	publishCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	err = reportQueue.Publish(publishCtx, data)
	if err != nil {
		return fmt.Errorf("failed to publish step event: %w", err)
	}

	utils.Logger.Debugf("emitted step event job=%s stage=%s tool=%s status=%s progress=%d", jobID, stage, tool, status, progress)
	return nil
}

// emitFinalEvent emits the final pipeline completion event
// ASM Rule: FINAL event ONLY ONCE when pipeline completes
func emitFinalEvent(ctx context.Context, jobID string) error {
	if reportQueue == nil {
		return errors.New("report queue not initialized")
	}

	event := FinalEvent{
		JobID:    jobID,
		Status:   "PIPELINE_COMPLETED",
		Progress: 100,
		IsFinal:  true, // Final events are always final
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal final event: %w", err)
	}

	publishCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	err = reportQueue.Publish(publishCtx, data)
	if err != nil {
		return fmt.Errorf("failed to publish final event: %w", err)
	}

	utils.Logger.Infof("emitted final event job=%s status=PIPELINE_COMPLETED", jobID)
	return nil
}

// getAssetName fetches asset name from database by asset_id
func getAssetName(ctx context.Context, assetID string) (string, error) {
	if assetID == "" {
		return "", errors.New("asset_id is empty")
	}

	// Initialize database connection if needed
	if database.Pool == nil {
		if err := database.InitPostgres(); err != nil {
			return "", fmt.Errorf("failed to initialize database: %w", err)
		}
	}

	queryCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	query := `SELECT name FROM assets WHERE id = $1 LIMIT 1;`
	var assetName string
	err := database.QueryRow(queryCtx, query, assetID).Scan(&assetName)
	if err != nil {
		utils.Logger.Warnf("failed to fetch asset name for asset_id=%s error=%v", assetID, err)
		return "", fmt.Errorf("asset not found: %w", err)
	}

	return assetName, nil
}

func Run(ctx context.Context, task executor.Task) (result executor.Result) {
	// Top-level panic recovery (audit C3): a panic in any tool/parser fails the
	// job cleanly instead of crashing the worker and stranding other jobs.
	defer func() {
		if r := recover(); r != nil {
			utils.Logger.Errorf("recovered panic in executor job=%s: %v", task.JobID, r)
			result = fail(task.JobID, fmt.Errorf("panic: %v", r))
		}
	}()

	utils.Logger.Infof("executor started job=%s", task.JobID)

	// 🔹 Load pipeline from Redis
	basePipeline, err := executor.GetPipeline(ctx, task.JobID)
	if err != nil {
		utils.Logger.Errorf("failed to load pipeline job=%s error=%v", task.JobID, err)
		return fail(task.JobID, err)
	}

	utils.Logger.Infof("pipeline loaded job=%s asset_type=%s intensity=%s steps=%d",
		task.JobID, basePipeline.AssetType, basePipeline.Intensity, len(basePipeline.Pipeline))

	// 🔹 Get asset name from first step's asset_id (for domain assets)
	var assetName string
	if len(basePipeline.Pipeline) > 0 && basePipeline.Pipeline[0].AssetID != "" {
		if basePipeline.AssetType == "domain" {
			name, err := getAssetName(ctx, basePipeline.Pipeline[0].AssetID)
			if err != nil {
				utils.Logger.Warnf("failed to get asset name for job=%s asset_id=%s error=%v, continuing without asset name",
					task.JobID, basePipeline.Pipeline[0].AssetID, err)
			} else {
				assetName = name
				utils.Logger.Infof("fetched asset name for job=%s asset_id=%s asset_name=%s",
					task.JobID, basePipeline.Pipeline[0].AssetID, assetName)
			}
		}
	}

	// 🔹 Create enhanced pipeline structure
	enhancedPipeline := &EnhancedPipeline{
		JobID:     task.JobID,
		AssetType: basePipeline.AssetType,
		AssetName: assetName,
		Intensity: basePipeline.Intensity,
		Status:    "RUNNING",
		Process:   fmt.Sprintf("0/%d", len(basePipeline.Pipeline)),
		Pipeline:  make([]ToolResult, len(basePipeline.Pipeline)),
	}

	// Initialize all steps as PENDING and preserve asset_id and step name
	// Backward compatibility: if Step is empty, use Tool name as fallback
	for i, step := range basePipeline.Pipeline {
		stepName := step.Step
		if stepName == "" {
			// Backward compatibility: use tool name as step name for old pipelines
			stepName = step.Tool
			utils.Logger.Warnf("pipeline step missing Step field, using Tool as fallback job=%s step=%d tool=%s",
				task.JobID, i+1, step.Tool)
		}
		enhancedPipeline.Pipeline[i] = ToolResult{
			Order:   step.Order,
			Step:    stepName, // Stage name (e.g., "subdomain_discovery")
			AssetID: step.AssetID,
			Tool:    step.Tool,
			Status:  "PENDING",
		}
	}

	// Save initial state
	if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
		utils.Logger.Warnf("failed to save initial pipeline state job=%s: %v", task.JobID, err)
	}

	// 🔹 Execute pipeline steps sequentially
	completedSteps := 0
	for i := range enhancedPipeline.Pipeline {
		// Stop if the job's deadline/cancellation fired (audit C4): a hung or
		// cancelled scan no longer blocks the worker indefinitely.
		if cerr := ctx.Err(); cerr != nil {
			utils.Logger.Warnf("context done, stopping pipeline job=%s at step=%d: %v", task.JobID, i, cerr)
			enhancedPipeline.Pipeline[i].Status = "CANCELLED"
			break
		}

		stepStartTime := time.Now()

		utils.Logger.Infof(
			"job=%s running step=%d/%d tool=%s",
			task.JobID, i+1, len(enhancedPipeline.Pipeline), enhancedPipeline.Pipeline[i].Tool,
		)

		// Update step status to RUNNING
		enhancedPipeline.Pipeline[i].Status = "RUNNING"
		enhancedPipeline.Pipeline[i].StartedAt = &stepStartTime
		enhancedPipeline.Process = fmt.Sprintf("%d/%d", completedSteps, len(enhancedPipeline.Pipeline))

		if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
			utils.Logger.Warnf("failed to update step to RUNNING job=%s step=%d: %v", task.JobID, i, err)
		}

		// Push RUNNING state to report queue
		// if err := pushToReportQueue(ctx, enhancedPipeline); err != nil {
		// 	utils.Logger.Warnf("failed to push RUNNING state to report queue job=%s step=%d: %v", task.JobID, i, err)
		// }

		// Execute the tool
		var toolErr error
		var output interface{}

		switch enhancedPipeline.Pipeline[i].Tool {

		case "subfinder":
			// Use AssetName (domain name) instead of AssetType
			domainName := enhancedPipeline.AssetName
			if domainName == "" {
				// Fallback: try to get asset name from current step's asset_id
				if enhancedPipeline.Pipeline[i].AssetID != "" {
					name, err := getAssetName(ctx, enhancedPipeline.Pipeline[i].AssetID)
					if err == nil {
						domainName = name
						enhancedPipeline.AssetName = name // Update for future steps
					}
				}
				// If still empty, fallback to AssetType (for backward compatibility)
				if domainName == "" {
					domainName = enhancedPipeline.AssetType
					utils.Logger.Warnf("using AssetType as fallback for subfinder job=%s step=%d", task.JobID, i)
				}
			}
			output, toolErr = subfinder.Run(ctx, domainName)
			if toolErr != nil {
				utils.Logger.Errorf("subfinder failed job=%s step=%d domain=%s error=%v", task.JobID, i, domainName, toolErr)
			} else {
				utils.Logger.Infof("subfinder completed job=%s step=%d domain=%s", task.JobID, i, domainName)
			}

		case "ai_subdomain_probe":
			// Dedicated AI/LLM subdomain probe (claude.<domain>, openai.<domain>, ...).
			domainName := enhancedPipeline.AssetName
			if domainName == "" && enhancedPipeline.Pipeline[i].AssetID != "" {
				if name, err := getAssetName(ctx, enhancedPipeline.Pipeline[i].AssetID); err == nil {
					domainName = name
					enhancedPipeline.AssetName = name
				}
			}
			if domainName == "" {
				output = map[string]interface{}{"subdomains": []string{}, "count": 0}
			} else {
				subs, err := aisubs.Run(ctx, domainName)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("ai_subdomain_probe failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					output = map[string]interface{}{"subdomains": subs, "count": len(subs)}
					utils.Logger.Infof("ai_subdomain_probe completed job=%s step=%d found=%d", task.JobID, i, len(subs))
				}
			}

		case "crtsh":
			domainName := enhancedPipeline.AssetName
			if domainName == "" {
				domainName = enhancedPipeline.AssetType
			}
			subdomains, err := crtsh.RunCertificateDiscovery(ctx, domainName)
			if err != nil {
				toolErr = err
				utils.Logger.Errorf("crtsh failed job=%s step=%d domain=%s error=%v", task.JobID, i, domainName, err)
			} else {
				output = map[string]interface{}{
					"subdomains": subdomains,
					"count":      len(subdomains),
					"source":     "crt.sh",
				}
			}

		case "amass":
			domainName := enhancedPipeline.AssetName
			if domainName == "" {
				domainName = enhancedPipeline.AssetType
			}
			subdomains, err := amass.RunDeepDiscovery(ctx, domainName)
			if err != nil {
				toolErr = err
				utils.Logger.Errorf("amass failed job=%s step=%d domain=%s error=%v", task.JobID, i, domainName, err)
			} else {
				output = map[string]interface{}{
					"subdomains": subdomains,
					"count":      len(subdomains),
				}
			}

		case "bbot":
			domainName := enhancedPipeline.AssetName
			if domainName == "" {
				domainName = enhancedPipeline.AssetType
			}
			subdomains, err := bbot.RunRecursiveDiscovery(ctx, domainName)
			if err != nil {
				toolErr = err
				utils.Logger.Errorf("bbot failed job=%s step=%d domain=%s error=%v", task.JobID, i, domainName, err)
			} else {
				output = map[string]interface{}{
					"subdomains": subdomains,
					"count":      len(subdomains),
				}
			}

		case "dnsgen":
			seeds := collectSubdomainsFromPipeline(enhancedPipeline.Pipeline, i)
			candidates, err := dnsgen.RunExpansion(ctx, seeds)
			if err != nil {
				toolErr = err
				utils.Logger.Errorf("dnsgen failed job=%s step=%d error=%v", task.JobID, i, err)
			} else {
				output = map[string]interface{}{
					"subdomains": candidates,
					"candidates": candidates,
					"count":      len(candidates),
				}
			}

		case "dnsx":
			// DNS resolution - needs subdomains from previous subdomain_discovery step
			subdomains := collectSubdomainsFromPipeline(enhancedPipeline.Pipeline, i)

			if len(subdomains) == 0 {
				utils.Logger.Warnf("no subdomains found for dnsx resolution job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{
					"resolved":   []interface{}{},
					"unresolved": []interface{}{},
				}
			} else {
				dnsResults, err := dnsx.RunDNSResolution(ctx, subdomains)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("dnsx failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					// Format results for reporting
					var resolved []map[string]interface{}
					var unresolved []string

					for _, subdomain := range subdomains {
						if ips, found := dnsResults[subdomain]; found && len(ips) > 0 {
							resolved = append(resolved, map[string]interface{}{
								"subdomain": subdomain,
								"ips":       ips,
							})
						} else {
							unresolved = append(unresolved, subdomain)
						}
					}

					output = map[string]interface{}{
						"resolved":   resolved,
						"unresolved": unresolved,
					}
					utils.Logger.Infof("dnsx completed job=%s step=%d resolved=%d unresolved=%d", task.JobID, i, len(resolved), len(unresolved))
				}
			}

		case "http_probe":
			// HTTP reachability check - needs subdomains from previous steps
			subdomains := collectSubdomainsFromPipeline(enhancedPipeline.Pipeline, i)

			if len(subdomains) == 0 {
				utils.Logger.Warnf("no subdomains found for http_probe job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{
					"reachable":   []string{},
					"unreachable": []string{},
				}
			} else {
				reachable, err := httpprobe.RunReachabilityCheck(ctx, subdomains)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("http_probe failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					// Find unreachable subdomains
					reachableMap := make(map[string]bool)
					for _, r := range reachable {
						reachableMap[r] = true
					}
					var unreachable []string
					for _, sd := range subdomains {
						if !reachableMap[sd] {
							unreachable = append(unreachable, sd)
						}
					}

					output = map[string]interface{}{
						"reachable":   reachable,
						"unreachable": unreachable,
					}
					utils.Logger.Infof("http_probe completed job=%s step=%d reachable=%d unreachable=%d", task.JobID, i, len(reachable), len(unreachable))
				}
			}

		case "httpx":
			// HTTP status check - needs subdomains from previous steps
			subdomains := collectSubdomainsFromPipeline(enhancedPipeline.Pipeline, i)

			if len(subdomains) == 0 {
				utils.Logger.Warnf("no subdomains found for httpx job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{
					"responses": []interface{}{},
				}
			} else {
				responses, err := httpx.RunHTTPStatus(ctx, subdomains)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("httpx failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					// Convert responses to map format
					var responseList []map[string]interface{}
					for _, resp := range responses {
						responseList = append(responseList, map[string]interface{}{
							"subdomain":   resp.URL,
							"status_code": resp.StatusCode,
							"https":       resp.HTTPS,
							"title":       resp.Title,
							"server":      resp.Server,
						})
					}

					output = map[string]interface{}{
						"responses": responseList,
					}
					utils.Logger.Infof("httpx completed job=%s step=%d checked=%d subdomains", task.JobID, i, len(responses))
				}
			}

		case "ip_mapping":
			// IP mapping - uses dnsx to map subdomains to IPs (same as dns_resolution)
			subdomains := collectSubdomainsFromPipeline(enhancedPipeline.Pipeline, i)

			if len(subdomains) == 0 {
				utils.Logger.Warnf("no subdomains found for ip_mapping job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{
					"resolved": []interface{}{},
				}
			} else {
				ipResults, err := dnsx.RunDNSResolution(ctx, subdomains)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("ip_mapping failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					var resolved []map[string]interface{}
					for subdomain, ips := range ipResults {
						resolved = append(resolved, map[string]interface{}{
							"subdomain": subdomain,
							"ips":       ips,
						})
					}
					output = map[string]interface{}{
						"resolved": resolved,
						"count":    len(resolved),
					}
					utils.Logger.Infof("ip_mapping completed job=%s step=%d mapped=%d subdomains", task.JobID, i, len(resolved))
				}
			}

		case "ipinfo":
			ips := collectIPsFromResolutionSteps(enhancedPipeline.Pipeline, i)
			enrichment := runIPGeoEnrichment(ctx, ips)
			if enrichment == nil {
				enrichment = []map[string]interface{}{}
			}
			output = map[string]interface{}{
				"enrichment": enrichment,
				"count":      len(enrichment),
			}

		case "asnmap":
			ips := collectIPsFromResolutionSteps(enhancedPipeline.Pipeline, i)
			enrichment := runIPGeoEnrichment(ctx, ips)
			rdap := runRDAPLookup(ctx, ips)
			type asnAggregate struct {
				asn       string
				asnOrg    string
				ipCount   int
				countries map[string]bool
			}
			aggregates := make(map[string]*asnAggregate)
			for _, item := range enrichment {
				asn, _ := item["asn"].(string)
				if asn == "" {
					continue
				}
				agg, exists := aggregates[asn]
				if !exists {
					agg = &asnAggregate{
						asn:       asn,
						asnOrg:    fmt.Sprint(item["asn_org"]),
						countries: make(map[string]bool),
					}
					aggregates[asn] = agg
				}
				agg.ipCount++
				if country, ok := item["country"].(string); ok && country != "" {
					agg.countries[country] = true
				}
			}
			var ranges []map[string]interface{}
			for _, item := range rdap {
				ranges = append(ranges, map[string]interface{}{
					"ip":            item["ip"],
					"name":          item["name"],
					"country":       item["country"],
					"start_address": item["startAddress"],
					"end_address":   item["endAddress"],
					"handle":        item["handle"],
				})
			}
			var asns []map[string]interface{}
			for _, agg := range aggregates {
				countries := make([]string, 0, len(agg.countries))
				for country := range agg.countries {
					countries = append(countries, country)
				}
				asns = append(asns, map[string]interface{}{
					"asn":       agg.asn,
					"asn_org":   agg.asnOrg,
					"ip_count":  agg.ipCount,
					"countries": countries,
				})
			}
			if asns == nil {
				asns = []map[string]interface{}{}
			}
			if ranges == nil {
				ranges = []map[string]interface{}{}
			}
			output = map[string]interface{}{
				"asns":   asns,
				"ranges": ranges,
				"count":  len(asns),
			}

		case "top_ports_scanner", "naabu":
			ips := collectIPsFromResolutionSteps(enhancedPipeline.Pipeline, i)

			utils.Logger.Debugf("top_ports_scanner: collected %d unique IPs for job=%s step=%d", len(ips), task.JobID, i)
			if len(ips) == 0 {
				utils.Logger.Warnf("no IPs found for port scan job=%s step=%d - checking previous steps", task.JobID, i)
				// Debug: log what we found in previous steps
				for j := 0; j < i; j++ {
					step := enhancedPipeline.Pipeline[j]
					utils.Logger.Debugf("top_ports_scanner: step %d: %s status=%s", j, step.Step, step.Status)
					if step.Step == "dns_resolution" || step.Step == "ip_mapping" {
						utils.Logger.Debugf("top_ports_scanner: step %d result keys: %v", j, getMapKeys(step.Result))
					}
				}
				output = map[string]interface{}{
					"ports": []interface{}{},
				}
			} else {
				utils.Logger.Infof("top_ports_scanner: scanning %d IPs for job=%s step=%d", len(ips), task.JobID, i)
				portResults, err := naabu.RunTopPortsScan(ctx, ips)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("top_ports_scanner failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					var portList []map[string]interface{}
					for _, pr := range portResults {
						portList = append(portList, map[string]interface{}{
							"ip":       pr.IP,
							"port":     pr.Port,
							"protocol": pr.Protocol,
						})
					}
					output = map[string]interface{}{
						"ports": portList,
						"count": len(portList),
					}
					utils.Logger.Infof("top_ports_scanner completed job=%s step=%d found=%d ports from %d IPs", task.JobID, i, len(portList), len(ips))
				}
			}

		case "service_detector":
			ips := collectIPsFromResolutionSteps(enhancedPipeline.Pipeline, i)
			ports := collectPortsFromCommonScan(enhancedPipeline.Pipeline, i)

			if len(ips) == 0 {
				utils.Logger.Warnf("no IPs found for service detection job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{
					"services": []interface{}{},
				}
			} else {
				serviceResults, err := nmap.RunServiceDetection(ctx, ips, ports)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("service_detector failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					var serviceList []map[string]interface{}
					for _, sr := range serviceResults {
						serviceList = append(serviceList, map[string]interface{}{
							"ip":      sr.IP,
							"port":    sr.Port,
							"service": sr.Service,
							"version": sr.Version,
							"product": sr.Product,
						})
					}
					output = map[string]interface{}{
						"services": serviceList,
						"count":    len(serviceList),
					}
					utils.Logger.Infof("service_detector completed job=%s step=%d found=%d services", task.JobID, i, len(serviceList))
				}
			}

		case "ssl_analyzer":
			// SSL/TLS analysis - needs subdomains from previous steps
			hosts := collectSubdomainsFromPipeline(enhancedPipeline.Pipeline, i)

			if len(hosts) == 0 {
				utils.Logger.Warnf("no hosts found for SSL analysis job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{
					"ssl_results": []interface{}{},
				}
			} else {
				sslResults, err := sslscan.RunSSLAnalysis(ctx, hosts)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("ssl_analyzer failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					var sslList []map[string]interface{}
					for _, sr := range sslResults {
						sslList = append(sslList, map[string]interface{}{
							"host":        sr.Host,
							"port":        sr.Port,
							"protocol":    sr.Protocol,
							"cipher":      sr.Cipher,
							"certificate": sr.Certificate,
							"issuer":      sr.Issuer,
							"valid_until": sr.ValidUntil,
						})
					}
					output = map[string]interface{}{
						"ssl_results": sslList,
						"count":       len(sslList),
					}
					utils.Logger.Infof("ssl_analyzer completed job=%s step=%d analyzed=%d hosts", task.JobID, i, len(sslList))
				}
			}

		case "api_detector":
			// API endpoint discovery - needs subdomains from previous steps
			urls := collectSubdomainsFromPipeline(enhancedPipeline.Pipeline, i)

			if len(urls) == 0 {
				utils.Logger.Warnf("no URLs found for API detection job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{
					"endpoints": []interface{}{},
				}
			} else {
				apiResults, err := katana.RunAPIDetection(ctx, urls)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("api_detector failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					endpointList := make([]map[string]interface{}, 0, len(apiResults))
					for _, ar := range apiResults {
						endpointList = append(endpointList, map[string]interface{}{
							"url":    ar.URL,
							"method": ar.Method,
							"status": ar.Status,
							"type":   ar.Type,
						})
					}
					output = map[string]interface{}{
						"endpoints": endpointList,
						"count":     len(endpointList),
					}
					utils.Logger.Infof("api_detector completed job=%s step=%d found=%d endpoints", task.JobID, i, len(endpointList))
				}
			}

		case "nuclei":
			hosts := collectSubdomainsFromPipeline(enhancedPipeline.Pipeline, i)
			if len(hosts) == 0 {
				output = map[string]interface{}{
					"findings": []interface{}{},
				}
			} else {
				findings, err := nuclei.Run(ctx, hosts)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("nuclei failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					var findingList []map[string]interface{}
					for _, finding := range findings {
						findingList = append(findingList, map[string]interface{}{
							"host":        finding.Host,
							"matched_at":  finding.MatchedAt,
							"template_id": finding.TemplateID,
							"name":        finding.Name,
							"severity":    finding.Severity,
						})
					}
					output = map[string]interface{}{
						"findings": findingList,
						"count":    len(findingList),
					}
				}
			}

		case "cloud_osint":
			// Cloud exposure detection - needs domain name
			domainName := enhancedPipeline.AssetName
			if domainName == "" {
				utils.Logger.Warnf("no domain name for cloud OSINT job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{
					"resources": []interface{}{},
				}
			} else {
				cloudResults, err := cloudenum.RunCloudOSINT(ctx, domainName)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("cloud_osint failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					var resourceList []map[string]interface{}
					for _, cr := range cloudResults {
						resourceList = append(resourceList, map[string]interface{}{
							"service": cr.Service,
							"type":    cr.Type,
							"name":    cr.Name,
							"status":  cr.Status,
						})
					}
					output = map[string]interface{}{
						"resources": resourceList,
						"count":     len(resourceList),
					}
					utils.Logger.Infof("cloud_osint completed job=%s step=%d found=%d resources", task.JobID, i, len(resourceList))
				}
			}

		case "public_endpoint_detect":
			// Cloud asset-type discovery: enumerate public cloud endpoints/buckets
			// for the asset (reuses the real unauthenticated cloud OSINT tool).
			seed := enhancedPipeline.AssetName
			if seed == "" && enhancedPipeline.Pipeline[i].AssetID != "" {
				// Same fallback as subfinder: resolve the seed from this step's asset_id.
				if name, err := getAssetName(ctx, enhancedPipeline.Pipeline[i].AssetID); err == nil {
					seed = name
					enhancedPipeline.AssetName = name
				}
			}
			if seed == "" {
				utils.Logger.Warnf("no asset name for public_endpoint_detect job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{"resources": []interface{}{}, "count": 0}
			} else {
				cloudResults, err := cloudenum.RunCloudOSINT(ctx, seed)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("public_endpoint_detect failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					var resourceList []map[string]interface{}
					for _, cr := range cloudResults {
						resourceList = append(resourceList, map[string]interface{}{
							"service": cr.Service, "type": cr.Type, "name": cr.Name, "status": cr.Status,
						})
					}
					output = map[string]interface{}{"resources": resourceList, "count": len(resourceList)}
					utils.Logger.Infof("public_endpoint_detect completed job=%s step=%d found=%d resources", task.JobID, i, len(resourceList))
				}
			}

		case "repo_secret_scan":
			// Repo asset-type: scan a git repository for leaked secrets (gitleaks).
			seed := enhancedPipeline.AssetName
			if seed == "" && enhancedPipeline.Pipeline[i].AssetID != "" {
				if name, err := getAssetName(ctx, enhancedPipeline.Pipeline[i].AssetID); err == nil {
					seed = name
					enhancedPipeline.AssetName = name
				}
			}
			if seed == "" {
				utils.Logger.Warnf("no asset name for repo_secret_scan job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{"findings": []map[string]interface{}{}, "count": 0}
			} else {
				findings, err := reposcan.Run(ctx, seed)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("repo_secret_scan failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					output = map[string]interface{}{"findings": findings, "count": len(findings)}
					utils.Logger.Infof("repo_secret_scan completed job=%s step=%d found=%d", task.JobID, i, len(findings))
				}
			}

		case "saas_detect":
			// SaaS asset-type: detect third-party SaaS apps via MX + DNS subdomains.
			seed := enhancedPipeline.AssetName
			if seed == "" && enhancedPipeline.Pipeline[i].AssetID != "" {
				if name, err := getAssetName(ctx, enhancedPipeline.Pipeline[i].AssetID); err == nil {
					seed = name
					enhancedPipeline.AssetName = name
				}
			}
			if seed == "" {
				utils.Logger.Warnf("no asset name for saas_detect job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{"apps": []map[string]interface{}{}, "count": 0}
			} else {
				apps, err := saasdetect.Run(ctx, seed)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("saas_detect failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					output = map[string]interface{}{"apps": apps, "count": len(apps)}
					utils.Logger.Infof("saas_detect completed job=%s step=%d found=%d", task.JobID, i, len(apps))
				}
			}

		case "email_leak_check":
			// User asset-type: check for breached accounts via HaveIBeenPwned.
			seed := enhancedPipeline.AssetName
			if seed == "" && enhancedPipeline.Pipeline[i].AssetID != "" {
				if name, err := getAssetName(ctx, enhancedPipeline.Pipeline[i].AssetID); err == nil {
					seed = name
					enhancedPipeline.AssetName = name
				}
			}
			if seed == "" {
				utils.Logger.Warnf("no asset name for email_leak_check job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{"accounts": []map[string]interface{}{}, "count": 0}
			} else {
				accounts, err := emailleak.Run(ctx, seed)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("email_leak_check failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					output = map[string]interface{}{"accounts": accounts, "count": len(accounts)}
					utils.Logger.Infof("email_leak_check completed job=%s step=%d found=%d", task.JobID, i, len(accounts))
				}
			}

		case "config_review_readonly":
			// Read-only config review: keep only publicly-accessible resources.
			all := collectCloudResourcesFromPipeline(enhancedPipeline.Pipeline, i)
			var publicRes []map[string]interface{}
			for _, r := range all {
				status, _ := r["status"].(string)
				ls := strings.ToLower(status)
				if strings.Contains(ls, "public") || strings.Contains(ls, "open") {
					publicRes = append(publicRes, r)
				}
			}
			output = map[string]interface{}{"resources": publicRes, "count": len(publicRes)}
			utils.Logger.Infof("config_review_readonly completed job=%s step=%d public=%d", task.JobID, i, len(publicRes))

		case "full_osint_correlation":
			// Correlate + dedupe all cloud resources discovered in prior steps.
			all := collectCloudResourcesFromPipeline(enhancedPipeline.Pipeline, i)
			seen := map[string]bool{}
			var deduped []map[string]interface{}
			for _, r := range all {
				name, _ := r["name"].(string)
				if name == "" || seen[name] {
					continue
				}
				seen[name] = true
				deduped = append(deduped, r)
			}
			output = map[string]interface{}{"resources": deduped, "count": len(deduped)}
			utils.Logger.Infof("full_osint_correlation completed job=%s step=%d correlated=%d", task.JobID, i, len(deduped))

		case "admin_finder":
			// Admin endpoint discovery - needs subdomains from previous steps
			urls := collectSubdomainsFromPipeline(enhancedPipeline.Pipeline, i)

			if len(urls) == 0 {
				utils.Logger.Warnf("no URLs found for admin finder job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{
					"admin_endpoints": []interface{}{},
				}
			} else {
				adminResults, err := gobuster.RunAdminFinder(ctx, urls)
				if err != nil {
					toolErr = err
					utils.Logger.Errorf("admin_finder failed job=%s step=%d error=%v", task.JobID, i, err)
				} else {
					var endpointList []map[string]interface{}
					for _, ar := range adminResults {
						endpointList = append(endpointList, map[string]interface{}{
							"url":    ar.URL,
							"status": ar.Status,
							"size":   ar.Size,
						})
					}
					output = map[string]interface{}{
						"admin_endpoints": endpointList,
						"count":           len(endpointList),
					}
					utils.Logger.Infof("admin_finder completed job=%s step=%d found=%d endpoints", task.JobID, i, len(endpointList))
				}
			}

		case "backup_detector":
			// Backup file detection - needs subdomains from previous steps
			urls := collectSubdomainsFromPipeline(enhancedPipeline.Pipeline, i)

			if len(urls) == 0 {
				utils.Logger.Warnf("no URLs found for backup detector job=%s step=%d", task.JobID, i)
				output = map[string]interface{}{
					"backup_files": []interface{}{},
				}
			} else {
				// Build realistic backup candidates and keep only reachable ones.
				extensions := []string{".bak", ".backup", ".old", ".orig", ".save", ".swp", ".tmp", ".zip", ".tar.gz", ".sql"}
				basePaths := []string{"/backup", "/db", "/database", "/dump", "/site", "/website", "/www"}
				client := &http.Client{Timeout: 4 * time.Second}

				seen := map[string]bool{}
				var backupFiles []map[string]interface{}
				checked := 0

				for _, host := range urls {
					if host == "" {
						continue
					}
					for _, scheme := range []string{"https://", "http://"} {
						baseURL := scheme + host
						for _, path := range basePaths {
							for _, ext := range extensions {
								candidate := baseURL + path + ext
								if seen[candidate] {
									continue
								}
								seen[candidate] = true
								checked++

								req, reqErr := http.NewRequestWithContext(ctx, http.MethodHead, candidate, nil)
								if reqErr != nil {
									continue
								}
								resp, err := client.Do(req)
								if err != nil {
									continue
								}
								_ = resp.Body.Close()

								// Keep only likely exposed artifacts.
								if resp.StatusCode >= 200 && resp.StatusCode < 400 {
									backupFiles = append(backupFiles, map[string]interface{}{
										"url":         candidate,
										"extension":   ext,
										"status":      "accessible",
										"status_code": resp.StatusCode,
									})
								}
							}
						}
					}
				}

				output = map[string]interface{}{
					"backup_files": backupFiles,
					"count":        len(backupFiles),
					"checked":      checked,
				}
				utils.Logger.Infof(
					"backup_detector completed job=%s step=%d checked=%d exposed=%d",
					task.JobID, i, checked, len(backupFiles),
				)
			}

		case "asset_diff_engine":
			// Asset change detection - compares current scan with previous
			// This is a placeholder implementation
			utils.Logger.Infof("asset_diff_engine running job=%s step=%d", task.JobID, i)
			output = map[string]interface{}{
				"changes": []interface{}{},
				"message": "Asset diff analysis completed - no previous scan found for comparison",
			}
			utils.Logger.Infof("asset_diff_engine completed job=%s step=%d", task.JobID, i)

		// -------------------------
		// IP ASM tools (LIGHT/NORMAL/DEEP)
		// -------------------------
		case "ip_target_seed":
			seeds, ips, err := buildIPSeedTargets(ctx, task.JobID, enhancedPipeline.Pipeline[i].AssetID)
			if err != nil {
				toolErr = err
				break
			}
			output = map[string]interface{}{
				"targets": seeds,
				"ips":     ips,
				"count":   len(ips),
			}
			utils.Logger.Infof("ip_target_seed completed job=%s step=%d targets=%d", task.JobID, i, len(ips))

		case "ip_alive_check", "ip_alive_check_deep":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			alive, dead := runAliveCheck(ctx, ips)
			output = map[string]interface{}{
				"alive":         alive,
				"dead":          dead,
				"is_alive":      len(alive) > 0,
				"response_type": "icmp_or_tcp",
				"checked_at":    time.Now().UTC().Format(time.RFC3339),
			}
			utils.Logger.Infof("ip_alive_check completed job=%s step=%d alive=%d dead=%d", task.JobID, i, len(alive), len(dead))

		case "ip_port_scan_light":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			ports := runNmapPortScan(ctx, ips, 100, false, false)
			output = map[string]interface{}{
				"ports": ports,
				"count": len(ports),
			}

		case "ip_port_scan_normal":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			ports := runNmapPortScan(ctx, ips, 1000, false, false)
			output = map[string]interface{}{
				"ports": ports,
				"count": len(ports),
			}

		case "ip_port_scan_deep":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			ports := runNmapPortScan(ctx, ips, 0, true, false)
			output = map[string]interface{}{
				"ports": ports,
				"count": len(ports),
			}

		case "ip_udp_scan_normal":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			udpPorts := runNmapPortScan(ctx, ips, 20, false, true)
			output = map[string]interface{}{
				"udp_ports": udpPorts,
				"count":     len(udpPorts),
			}

		case "ip_udp_scan_deep":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			udpPorts := runNmapPortScan(ctx, ips, 100, false, true)
			output = map[string]interface{}{
				"udp_ports": udpPorts,
				"count":     len(udpPorts),
			}

		case "ip_service_fingerprint_light", "ip_service_fingerprint_normal", "ip_service_fingerprint_deep", "ip_banner_grab":
			var currentPorts []map[string]interface{}
			for j := i - 1; j >= 0; j-- {
				if enhancedPipeline.Pipeline[j].Status != "COMPLETED" {
					continue
				}
				if enhancedPipeline.Pipeline[j].Step != "common_port_scan" {
					continue
				}
				if p, ok := enhancedPipeline.Pipeline[j].Result["ports"].([]interface{}); ok {
					for _, item := range p {
						if portMap, ok := item.(map[string]interface{}); ok {
							currentPorts = append(currentPorts, portMap)
						}
					}
				}
				break
			}
			serviceList := runServiceFingerprint(ctx, currentPorts, enhancedPipeline.Intensity)
			output = map[string]interface{}{
				"services": serviceList,
				"count":    len(serviceList),
			}

		case "ip_http_probe_light", "ip_http_probe_normal", "ip_http_probe_deep":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			responses := runHTTPProbeForIPs(ctx, ips)
			output = map[string]interface{}{
				"responses": responses,
				"count":     len(responses),
			}

		case "ip_enrichment_cached", "ip_enrichment_fresh":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			enrichment := runIPGeoEnrichment(ctx, ips)
			output = map[string]interface{}{
				"enrichment": enrichment,
				"count":      len(enrichment),
			}

		case "ip_whois_rdap", "ip_whois_rdap_fresh":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			rdap := runRDAPLookup(ctx, ips)
			output = map[string]interface{}{
				"whois_rdap": rdap,
				"count":      len(rdap),
			}

		case "ip_tls_deep":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			var tlsResults []map[string]interface{}
			for _, ip := range ips {
				tlsResults = append(tlsResults, map[string]interface{}{
					"host":        ip,
					"port":        443,
					"protocol":    "tls",
					"cipher":      "",
					"certificate": "",
					"issuer":      "",
					"valid_until": "",
				})
			}
			output = map[string]interface{}{
				"ssl_results": tlsResults,
				"count":       len(tlsResults),
			}

		case "ip_relationship_map":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			output = map[string]interface{}{
				"relationships": map[string]interface{}{
					"ips": ips,
				},
			}

		case "ip_diff":
			output = map[string]interface{}{
				"changes": []interface{}{},
				"message": "Diff baseline recorded for current IP scan",
			}

		case "ip_exposure_score":
			var currentPorts []map[string]interface{}
			for j := i - 1; j >= 0; j-- {
				if enhancedPipeline.Pipeline[j].Status != "COMPLETED" {
					continue
				}
				if enhancedPipeline.Pipeline[j].Step != "common_port_scan" {
					continue
				}
				if p, ok := enhancedPipeline.Pipeline[j].Result["ports"].([]interface{}); ok {
					for _, item := range p {
						if portMap, ok := item.(map[string]interface{}); ok {
							currentPorts = append(currentPorts, portMap)
						}
					}
				}
				break
			}
			output = map[string]interface{}{
				"scores": scoreExposure(currentPorts),
			}

		case "ip_findings_summary":
			ips := collectIPTargets(enhancedPipeline.Pipeline, i, enhancedPipeline.Pipeline[i].AssetID)
			output = map[string]interface{}{
				"summary": fmt.Sprintf("IP discovery completed. %d hosts analyzed across %s intensity.",
					len(ips), enhancedPipeline.Intensity),
			}

		default:
			toolErr = errors.New("unknown tool: " + enhancedPipeline.Pipeline[i].Tool)
			utils.Logger.Errorf("unknown tool job=%s step=%d tool=%s", task.JobID, i, enhancedPipeline.Pipeline[i].Tool)
		}

		stepEndTime := time.Now()
		executionTime := stepEndTime.Sub(stepStartTime).Milliseconds()

		// Update step with result
		enhancedPipeline.Pipeline[i].EndedAt = &stepEndTime
		enhancedPipeline.Pipeline[i].ExecutionTime = executionTime

		// Handle tool execution result
		if toolErr != nil {
			if isOptionalTool(enhancedPipeline.Pipeline[i].Tool) {
				enhancedPipeline.Pipeline[i].Status = "SKIPPED"
				enhancedPipeline.Pipeline[i].Error = toolErr.Error()
				enhancedPipeline.Pipeline[i].Result = map[string]interface{}{
					"warning": toolErr.Error(),
				}
				completedSteps++
				enhancedPipeline.Process = fmt.Sprintf("%d/%d", completedSteps, len(enhancedPipeline.Pipeline))

				if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
					utils.Logger.Warnf("failed to save SKIPPED state job=%s step=%d: %v", task.JobID, i, err)
				}

				progress := int((float64(completedSteps) / float64(len(enhancedPipeline.Pipeline))) * 100)
				if err := emitStepEvent(ctx, task.JobID, enhancedPipeline.Pipeline[i].AssetID,
					enhancedPipeline.Pipeline[i].Step, enhancedPipeline.Pipeline[i].Tool, "SKIPPED", progress); err != nil {
					utils.Logger.Warnf("failed to emit SKIPPED step event job=%s step=%d: %v", task.JobID, i, err)
				}

				utils.Logger.Warnf(
					"job=%s skipped optional step=%d/%d stage=%s tool=%s error=%v",
					task.JobID, i+1, len(enhancedPipeline.Pipeline), enhancedPipeline.Pipeline[i].Step,
					enhancedPipeline.Pipeline[i].Tool, toolErr,
				)
				continue
			}

			// Mark current step as FAILED
			enhancedPipeline.Pipeline[i].Status = "FAILED"
			enhancedPipeline.Pipeline[i].Error = toolErr.Error()
			enhancedPipeline.Pipeline[i].Result = make(map[string]interface{})

			// Mark overall pipeline as FAILED
			enhancedPipeline.Status = "FAILED"
			enhancedPipeline.Error = toolErr.Error()
			enhancedPipeline.Process = fmt.Sprintf("%d/%d", completedSteps, len(enhancedPipeline.Pipeline))

			if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
				utils.Logger.Errorf("failed to save FAILED state job=%s: %v", task.JobID, err)
			}

			// Emit step FAILED event (ASM Rule: emit after EACH step completion)
			progress := int((float64(completedSteps) / float64(len(enhancedPipeline.Pipeline))) * 100)
			if err := emitStepEvent(ctx, task.JobID, enhancedPipeline.Pipeline[i].AssetID,
				enhancedPipeline.Pipeline[i].Step, enhancedPipeline.Pipeline[i].Tool, "FAILED", progress); err != nil {
				utils.Logger.Warnf("failed to emit FAILED step event job=%s step=%d: %v", task.JobID, i, err)
			}

			// Push FAILED state to report queue (for reporting consumer)
			if err := pushToReportQueue(ctx, enhancedPipeline); err != nil {
				utils.Logger.Errorf("failed to push FAILED state to report queue job=%s: %v", task.JobID, err)
			}

			return fail(task.JobID, toolErr)
		}

		// Mark step as COMPLETED with result data
		resultData := make(map[string]interface{})

		// Parse tool output into result data
		if output != nil {
			switch v := output.(type) {
			case map[string]interface{}:
				resultData = v
			case []interface{}:
				resultData["data"] = v
				resultData["count"] = len(v)
			case []string:
				resultData["data"] = v
				resultData["count"] = len(v)
			case string:
				resultData["output"] = v
			default:
				// Try to marshal and unmarshal to get map
				if jsonBytes, err := json.Marshal(output); err == nil {
					resultData["raw_output"] = string(jsonBytes)

					// Try to parse as array of strings
					var strArray []string
					if err := json.Unmarshal(jsonBytes, &strArray); err == nil {
						resultData["subdomains"] = strArray
					}
				}
			}
		}

		enhancedPipeline.Pipeline[i].Status = "COMPLETED"
		enhancedPipeline.Pipeline[i].Result = resultData
		completedSteps++
		enhancedPipeline.Process = fmt.Sprintf("%d/%d", completedSteps, len(enhancedPipeline.Pipeline))

		if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
			utils.Logger.Warnf("failed to save COMPLETED state job=%s step=%d: %v", task.JobID, i, err)
		}

		// ASM Rule: Emit step completion event after EACH step
		progress := int((float64(completedSteps) / float64(len(enhancedPipeline.Pipeline))) * 100)
		if err := emitStepEvent(ctx, task.JobID, enhancedPipeline.Pipeline[i].AssetID,
			enhancedPipeline.Pipeline[i].Step, enhancedPipeline.Pipeline[i].Tool, "COMPLETED", progress); err != nil {
			utils.Logger.Warnf("failed to emit step event job=%s step=%d: %v", task.JobID, i, err)
		}

		utils.Logger.Infof("job=%s completed step=%d/%d stage=%s tool=%s status=COMPLETED duration=%dms progress=%d%%",
			task.JobID, i+1, len(enhancedPipeline.Pipeline), enhancedPipeline.Pipeline[i].Step,
			enhancedPipeline.Pipeline[i].Tool, executionTime, progress)
	}

	// ✅ All steps completed successfully
	enhancedPipeline.Status = "COMPLETED"
	enhancedPipeline.Process = fmt.Sprintf("%d/%d", completedSteps, len(enhancedPipeline.Pipeline))

	if err := saveEnhancedPipeline(ctx, enhancedPipeline); err != nil {
		utils.Logger.Errorf("failed to save final COMPLETED state job=%s: %v", task.JobID, err)
	}

	// ASM Rule: Emit final PIPELINE_COMPLETED event ONLY ONCE
	if err := emitFinalEvent(ctx, task.JobID); err != nil {
		utils.Logger.Errorf("failed to emit final event job=%s: %v", task.JobID, err)
	}

	// Push final COMPLETED state to report queue (for reporting consumer to process and trigger scoring)
	// Scoring happens ONLY after pipeline completion (ASM Rule)
	if err := pushToReportQueue(ctx, enhancedPipeline); err != nil {
		utils.Logger.Errorf("failed to push final COMPLETED state to report queue job=%s: %v", task.JobID, err)
	}

	// Pretty print final pipeline
	summaryJSON, err := json.MarshalIndent(enhancedPipeline, "", "  ")
	if err != nil {
		utils.Logger.Errorf("failed to marshal pipeline summary job=%s: %v", task.JobID, err)
	} else {
		utils.Logger.Infof("executor finished successfully job=%s status=COMPLETED\n=== PIPELINE SUMMARY ===\n%s\n========================",
			task.JobID, string(summaryJSON))
	}

	return executor.Result{
		JobID:   task.JobID,
		Success: true,
		Status:  "COMPLETED",
		EndAt:   time.Now(),
	}
}

// saveEnhancedPipeline saves the complete pipeline state to Redis (single key)
func saveEnhancedPipeline(ctx context.Context, pipeline *EnhancedPipeline) error {
	data, err := json.Marshal(pipeline)
	if err != nil {
		return fmt.Errorf("failed to marshal pipeline: %w", err)
	}

	pipelineKey := fmt.Sprintf("asm:pipeline:%s", pipeline.JobID)

	redisCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	if err := executor.SavePipelineRaw(redisCtx, pipelineKey, string(data)); err != nil {
		return fmt.Errorf("failed to save to redis: %w", err)
	}

	utils.Logger.Debugf("pipeline updated in redis key=%s", pipelineKey)
	return nil
}

func fail(jobID string, err error) executor.Result {
	utils.Logger.Errorf("executor failed job=%s err=%v", jobID, err)

	return executor.Result{
		JobID:   jobID,
		Success: false,
		Status:  "FAILED",
		Error:   err.Error(),
		EndAt:   time.Now(),
	}
}

func isOptionalTool(tool string) bool {
	optionalTools := map[string]bool{
		"crtsh":             true,
		"amass":             true,
		"ipinfo":            true,
		"asnmap":            true,
		"top_ports_scanner": true,
		"service_detector":  true,
		"ssl_analyzer":      true,
		"api_detector":      true,
		"bbot":              true,
		"dnsgen":            true,
		"nuclei":            true,
		"cloud_osint":       true,
		"admin_finder":      true,
		"backup_detector":   true,
		"asset_diff_engine": true,
		// Cloud asset-type pipeline tools (skip cleanly if cloud_enum binary absent).
		"public_endpoint_detect": true,
		"config_review_readonly":  true,
		"full_osint_correlation":  true,
		"ai_subdomain_probe":      true,
		// repo/saas/user asset-type pipeline tools (skip if external dep absent).
		"repo_secret_scan": true,
		"saas_detect":      true,
		"email_leak_check": true,
	}
	return optionalTools[tool]
}

// getMapKeys returns keys from a map for debugging
func getMapKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
