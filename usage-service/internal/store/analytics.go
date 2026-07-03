package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/seakee/cpa-manager/usage-service/internal/usage"
)

const maxMonitoringAnalyticsEvents = 100000

type MonitoringAnalyticsFilters struct {
	Models        []string `json:"models,omitempty"`
	Providers     []string `json:"providers,omitempty"`
	Accounts      []string `json:"accounts,omitempty"`
	AuthFiles     []string `json:"auth_files,omitempty"`
	AuthIndices   []string `json:"auth_indices,omitempty"`
	APIKeyHashes  []string `json:"api_key_hashes,omitempty"`
	SourceHashes  []string `json:"source_hashes,omitempty"`
	ProjectIDs    []string `json:"project_ids,omitempty"`
	RequestTypes  []string `json:"request_types,omitempty"`
	IncludeFailed *bool    `json:"include_failed,omitempty"`
	FailedOnly    bool     `json:"failed_only,omitempty"`
	MinLatencyMS  *int64   `json:"min_latency_ms,omitempty"`
	CacheStatus   string   `json:"cache_status,omitempty"`
}

type MonitoringAnalyticsEventsPageRequest struct {
	Limit    int    `json:"limit,omitempty"`
	BeforeMS *int64 `json:"before_ms,omitempty"`
	BeforeID *int64 `json:"before_id,omitempty"`
}

type MonitoringAnalyticsDrilldownPreviewRequest struct {
	FromMS int64 `json:"from_ms"`
	ToMS   int64 `json:"to_ms"`
	Limit  int   `json:"limit,omitempty"`
}

type MonitoringAnalyticsInclude struct {
	Summary            bool                                        `json:"summary,omitempty"`
	SummaryComparison  bool                                        `json:"summary_comparison,omitempty"`
	Timeline           bool                                        `json:"timeline,omitempty"`
	HourlyDistribution bool                                        `json:"hourly_distribution,omitempty"`
	ModelShare         bool                                        `json:"model_share,omitempty"`
	ChannelShare       bool                                        `json:"channel_share,omitempty"`
	ModelStats         bool                                        `json:"model_stats,omitempty"`
	FailureSources     bool                                        `json:"failure_sources,omitempty"`
	AccountStats       bool                                        `json:"account_stats,omitempty"`
	CredentialStats    bool                                        `json:"credential_stats,omitempty"`
	CredentialTimeline bool                                        `json:"credential_timeline,omitempty"`
	APIKeyStats        bool                                        `json:"api_key_stats,omitempty"`
	FilterOptions      bool                                        `json:"filter_options,omitempty"`
	Heatmap            bool                                        `json:"heatmap,omitempty"`
	AnomalyPoints      bool                                        `json:"anomaly_points,omitempty"`
	TaskBuckets        bool                                        `json:"task_buckets,omitempty"`
	RecentFailures     int                                         `json:"recent_failures,omitempty"`
	EventsPage         *MonitoringAnalyticsEventsPageRequest       `json:"events_page,omitempty"`
	DrilldownPreview   *MonitoringAnalyticsDrilldownPreviewRequest `json:"drilldown_preview,omitempty"`
	Granularity        string                                      `json:"granularity,omitempty"`
}

type MonitoringAnalyticsRequest struct {
	FromMS           int64                      `json:"from_ms"`
	ToMS             int64                      `json:"to_ms"`
	NowMS            int64                      `json:"now_ms,omitempty"`
	TimeZone         string                     `json:"time_zone,omitempty"`
	SearchQuery      string                     `json:"search_query,omitempty"`
	SearchAPIKeyHash string                     `json:"search_api_key_hash,omitempty"`
	Filters          MonitoringAnalyticsFilters `json:"filters,omitempty"`
	Include          MonitoringAnalyticsInclude `json:"include,omitempty"`
}

type MonitoringAnalyticsSummary struct {
	TotalCalls            int64    `json:"total_calls"`
	SuccessCalls          int64    `json:"success_calls"`
	FailureCalls          int64    `json:"failure_calls"`
	SuccessRate           float64  `json:"success_rate"`
	InputTokens           int64    `json:"input_tokens"`
	OutputTokens          int64    `json:"output_tokens"`
	CachedTokens          int64    `json:"cached_tokens"`
	CacheReadTokens       int64    `json:"cache_read_tokens"`
	CacheCreationTokens   int64    `json:"cache_creation_tokens"`
	ReasoningTokens       int64    `json:"reasoning_tokens"`
	TotalTokens           int64    `json:"total_tokens"`
	TotalCost             float64  `json:"total_cost"`
	AverageCostPerCall    float64  `json:"average_cost_per_call,omitempty"`
	AverageLatencyMS      *int64   `json:"average_latency_ms"`
	P95LatencyMS          *int64   `json:"p95_latency_ms,omitempty"`
	P95TTFTMS             *int64   `json:"p95_ttft_ms,omitempty"`
	ZeroTokenCalls        int64    `json:"zero_token_calls"`
	RPM30M                float64  `json:"rpm_30m"`
	TPM30M                float64  `json:"tpm_30m"`
	AvgDailyRequests      float64  `json:"avg_daily_requests"`
	AvgDailyTokens        float64  `json:"avg_daily_tokens"`
	ApproxTasks           int64    `json:"approx_tasks"`
	ApproxTaskFailures    int64    `json:"approx_task_failures"`
	ApproxTaskSuccessRate float64  `json:"approx_task_success_rate"`
	ZeroTokenModels       []string `json:"zero_token_models"`
}

type MonitoringAnalyticsSummaryComparison struct {
	FromMS       int64   `json:"from_ms"`
	ToMS         int64   `json:"to_ms"`
	TotalCalls   int64   `json:"total_calls"`
	SuccessCalls int64   `json:"success_calls"`
	FailureCalls int64   `json:"failure_calls"`
	SuccessRate  float64 `json:"success_rate"`
	TotalTokens  int64   `json:"total_tokens"`
	TotalCost    float64 `json:"total_cost"`
}

type MonitoringAnalyticsTimelinePoint struct {
	BucketMS            int64   `json:"bucket_ms"`
	BucketEndMS         int64   `json:"bucket_end_ms,omitempty"`
	Label               string  `json:"label"`
	Calls               int64   `json:"calls"`
	Tokens              int64   `json:"tokens"`
	Success             int64   `json:"success"`
	Failure             int64   `json:"failure"`
	InputTokens         int64   `json:"input_tokens,omitempty"`
	OutputTokens        int64   `json:"output_tokens,omitempty"`
	CachedTokens        int64   `json:"cached_tokens,omitempty"`
	CacheReadTokens     int64   `json:"cache_read_tokens,omitempty"`
	CacheCreationTokens int64   `json:"cache_creation_tokens,omitempty"`
	ReasoningTokens     int64   `json:"reasoning_tokens,omitempty"`
	TotalTokens         int64   `json:"total_tokens,omitempty"`
	Cost                float64 `json:"cost,omitempty"`
	AverageLatencyMS    *int64  `json:"average_latency_ms,omitempty"`
	P95LatencyMS        *int64  `json:"p95_latency_ms,omitempty"`
	SuccessRate         float64 `json:"success_rate,omitempty"`
	FailureRate         float64 `json:"failure_rate,omitempty"`
}

type MonitoringAnalyticsHourlyPoint struct {
	Hour   int   `json:"hour"`
	Calls  int64 `json:"calls"`
	Tokens int64 `json:"tokens"`
}

type MonitoringAnalyticsModelShareRow struct {
	Model  string  `json:"model"`
	Calls  int64   `json:"calls"`
	Tokens int64   `json:"tokens"`
	Cost   float64 `json:"cost"`
}

type MonitoringAnalyticsModelStat struct {
	Model               string  `json:"model"`
	Calls               int64   `json:"calls"`
	SuccessCalls        int64   `json:"success_calls"`
	FailureCalls        int64   `json:"failure_calls"`
	SuccessRate         float64 `json:"success_rate"`
	InputTokens         int64   `json:"input_tokens"`
	OutputTokens        int64   `json:"output_tokens"`
	CachedTokens        int64   `json:"cached_tokens"`
	CacheReadTokens     int64   `json:"cache_read_tokens"`
	CacheCreationTokens int64   `json:"cache_creation_tokens"`
	TotalTokens         int64   `json:"total_tokens"`
	Cost                float64 `json:"cost"`
}

type MonitoringAnalyticsChannelShareRow struct {
	AuthIndex            string  `json:"auth_index"`
	Source               string  `json:"source,omitempty"`
	AccountSnapshot      string  `json:"account_snapshot,omitempty"`
	AuthLabelSnapshot    string  `json:"auth_label_snapshot,omitempty"`
	AuthProviderSnapshot string  `json:"auth_provider_snapshot,omitempty"`
	Calls                int64   `json:"calls"`
	Success              int64   `json:"success"`
	Failure              int64   `json:"failure"`
	Tokens               int64   `json:"tokens"`
	Cost                 float64 `json:"cost"`
	AverageLatencyMS     *int64  `json:"average_latency_ms"`
}

type MonitoringAnalyticsAccountModelStatRow struct {
	Model               string  `json:"model"`
	Calls               int64   `json:"calls"`
	SuccessCalls        int64   `json:"success_calls"`
	FailureCalls        int64   `json:"failure_calls"`
	SuccessRate         float64 `json:"success_rate"`
	InputTokens         int64   `json:"input_tokens"`
	OutputTokens        int64   `json:"output_tokens"`
	CachedTokens        int64   `json:"cached_tokens"`
	CacheReadTokens     int64   `json:"cache_read_tokens"`
	CacheCreationTokens int64   `json:"cache_creation_tokens"`
	TotalTokens         int64   `json:"total_tokens"`
	Cost                float64 `json:"cost"`
	LastSeenMS          int64   `json:"last_seen_ms"`
}

type MonitoringAnalyticsAccountStatRow struct {
	ID                   string                                   `json:"id"`
	AccountSnapshot      string                                   `json:"account_snapshot,omitempty"`
	AuthLabelSnapshot    string                                   `json:"auth_label_snapshot,omitempty"`
	AuthProviderSnapshot string                                   `json:"auth_provider_snapshot,omitempty"`
	AuthIndices          []string                                 `json:"auth_indices,omitempty"`
	Sources              []string                                 `json:"sources,omitempty"`
	SourceHashes         []string                                 `json:"source_hashes,omitempty"`
	Calls                int64                                    `json:"calls"`
	SuccessCalls         int64                                    `json:"success_calls"`
	FailureCalls         int64                                    `json:"failure_calls"`
	SuccessRate          float64                                  `json:"success_rate"`
	InputTokens          int64                                    `json:"input_tokens"`
	OutputTokens         int64                                    `json:"output_tokens"`
	CachedTokens         int64                                    `json:"cached_tokens"`
	CacheReadTokens      int64                                    `json:"cache_read_tokens"`
	CacheCreationTokens  int64                                    `json:"cache_creation_tokens"`
	TotalTokens          int64                                    `json:"total_tokens"`
	Cost                 float64                                  `json:"cost"`
	AverageLatencyMS     *int64                                   `json:"average_latency_ms"`
	LastSeenMS           int64                                    `json:"last_seen_ms"`
	Models               []MonitoringAnalyticsAccountModelStatRow `json:"models,omitempty"`
}

type MonitoringAnalyticsCredentialStatRow struct {
	ID                    string                                   `json:"id"`
	AuthFileSnapshot      string                                   `json:"auth_file_snapshot,omitempty"`
	AuthIndex             string                                   `json:"auth_index,omitempty"`
	Source                string                                   `json:"source,omitempty"`
	SourceHash            string                                   `json:"source_hash,omitempty"`
	AccountSnapshot       string                                   `json:"account_snapshot,omitempty"`
	AuthLabelSnapshot     string                                   `json:"auth_label_snapshot,omitempty"`
	AuthProviderSnapshot  string                                   `json:"auth_provider_snapshot,omitempty"`
	AuthProjectIDSnapshot string                                   `json:"auth_project_id_snapshot,omitempty"`
	Calls                 int64                                    `json:"calls"`
	SuccessCalls          int64                                    `json:"success_calls"`
	FailureCalls          int64                                    `json:"failure_calls"`
	SuccessRate           float64                                  `json:"success_rate"`
	InputTokens           int64                                    `json:"input_tokens"`
	OutputTokens          int64                                    `json:"output_tokens"`
	CachedTokens          int64                                    `json:"cached_tokens"`
	CacheReadTokens       int64                                    `json:"cache_read_tokens"`
	CacheCreationTokens   int64                                    `json:"cache_creation_tokens"`
	TotalTokens           int64                                    `json:"total_tokens"`
	Cost                  float64                                  `json:"cost"`
	AverageLatencyMS      *int64                                   `json:"average_latency_ms"`
	LastSeenMS            int64                                    `json:"last_seen_ms"`
	Models                []MonitoringAnalyticsAccountModelStatRow `json:"models,omitempty"`
}

type MonitoringAnalyticsCredentialTimelinePoint struct {
	ID                   string  `json:"id"`
	Label                string  `json:"label,omitempty"`
	AuthFileSnapshot     string  `json:"auth_file_snapshot,omitempty"`
	AuthIndex            string  `json:"auth_index,omitempty"`
	Source               string  `json:"source,omitempty"`
	SourceHash           string  `json:"source_hash,omitempty"`
	AccountSnapshot      string  `json:"account_snapshot,omitempty"`
	AuthLabelSnapshot    string  `json:"auth_label_snapshot,omitempty"`
	AuthProviderSnapshot string  `json:"auth_provider_snapshot,omitempty"`
	BucketMS             int64   `json:"bucket_ms"`
	BucketLabel          string  `json:"bucket_label,omitempty"`
	Calls                int64   `json:"calls"`
	Tokens               int64   `json:"tokens"`
	Success              int64   `json:"success"`
	Failure              int64   `json:"failure"`
	InputTokens          int64   `json:"input_tokens,omitempty"`
	OutputTokens         int64   `json:"output_tokens,omitempty"`
	CachedTokens         int64   `json:"cached_tokens,omitempty"`
	CacheReadTokens      int64   `json:"cache_read_tokens,omitempty"`
	CacheCreationTokens  int64   `json:"cache_creation_tokens,omitempty"`
	ReasoningTokens      int64   `json:"reasoning_tokens,omitempty"`
	TotalTokens          int64   `json:"total_tokens,omitempty"`
	Cost                 float64 `json:"cost,omitempty"`
	AverageLatencyMS     *int64  `json:"average_latency_ms,omitempty"`
	SuccessRate          float64 `json:"success_rate,omitempty"`
	FailureRate          float64 `json:"failure_rate,omitempty"`
}

type MonitoringAnalyticsAPIKeyContextRow struct {
	ID                   string  `json:"id"`
	AccountSnapshot      string  `json:"account_snapshot,omitempty"`
	AuthLabelSnapshot    string  `json:"auth_label_snapshot,omitempty"`
	AuthProviderSnapshot string  `json:"auth_provider_snapshot,omitempty"`
	AuthIndex            string  `json:"auth_index,omitempty"`
	Source               string  `json:"source,omitempty"`
	SourceHash           string  `json:"source_hash,omitempty"`
	Calls                int64   `json:"calls"`
	SuccessCalls         int64   `json:"success_calls"`
	FailureCalls         int64   `json:"failure_calls"`
	SuccessRate          float64 `json:"success_rate"`
	FailureRate          float64 `json:"failure_rate"`
	TotalTokens          int64   `json:"total_tokens"`
	Cost                 float64 `json:"cost"`
	AverageLatencyMS     *int64  `json:"average_latency_ms,omitempty"`
	LastSeenMS           int64   `json:"last_seen_ms"`
}

type MonitoringAnalyticsAPIKeyStatRow struct {
	ID                   string                                   `json:"id"`
	APIKeyHash           string                                   `json:"api_key_hash"`
	AccountSnapshot      string                                   `json:"account_snapshot,omitempty"`
	AuthLabelSnapshot    string                                   `json:"auth_label_snapshot,omitempty"`
	AuthProviderSnapshot string                                   `json:"auth_provider_snapshot,omitempty"`
	AuthIndices          []string                                 `json:"auth_indices,omitempty"`
	Sources              []string                                 `json:"sources,omitempty"`
	SourceHashes         []string                                 `json:"source_hashes,omitempty"`
	Calls                int64                                    `json:"calls"`
	SuccessCalls         int64                                    `json:"success_calls"`
	FailureCalls         int64                                    `json:"failure_calls"`
	SuccessRate          float64                                  `json:"success_rate"`
	InputTokens          int64                                    `json:"input_tokens"`
	OutputTokens         int64                                    `json:"output_tokens"`
	CachedTokens         int64                                    `json:"cached_tokens"`
	CacheReadTokens      int64                                    `json:"cache_read_tokens"`
	CacheCreationTokens  int64                                    `json:"cache_creation_tokens"`
	TotalTokens          int64                                    `json:"total_tokens"`
	Cost                 float64                                  `json:"cost"`
	AverageLatencyMS     *int64                                   `json:"average_latency_ms"`
	LastSeenMS           int64                                    `json:"last_seen_ms"`
	Models               []MonitoringAnalyticsAccountModelStatRow `json:"models,omitempty"`
	Contexts             []MonitoringAnalyticsAPIKeyContextRow    `json:"contexts,omitempty"`
}

type MonitoringAnalyticsFilterOptions struct {
	AccountStats []MonitoringAnalyticsAccountStatRow  `json:"account_stats,omitempty"`
	APIKeyStats  []MonitoringAnalyticsAPIKeyStatRow   `json:"api_key_stats,omitempty"`
	ChannelShare []MonitoringAnalyticsChannelShareRow `json:"channel_share,omitempty"`
	ModelStats   []MonitoringAnalyticsModelStat       `json:"model_stats,omitempty"`
	Providers    []string                             `json:"providers,omitempty"`
	AuthFiles    []string                             `json:"auth_files,omitempty"`
	ProjectIDs   []string                             `json:"project_ids,omitempty"`
	RequestTypes []string                             `json:"request_types,omitempty"`
}

type MonitoringAnalyticsEventRow struct {
	RequestID             string `json:"request_id,omitempty"`
	EventHash             string `json:"event_hash"`
	TimestampMS           int64  `json:"timestamp_ms"`
	Model                 string `json:"model"`
	Endpoint              string `json:"endpoint"`
	Method                string `json:"method"`
	Path                  string `json:"path"`
	AuthIndex             string `json:"auth_index"`
	Source                string `json:"source"`
	SourceHash            string `json:"source_hash"`
	APIKeyHash            string `json:"api_key_hash"`
	AccountSnapshot       string `json:"account_snapshot"`
	AuthLabelSnapshot     string `json:"auth_label_snapshot"`
	AuthFileSnapshot      string `json:"auth_file_snapshot,omitempty"`
	AuthProviderSnapshot  string `json:"auth_provider_snapshot"`
	AuthProjectIDSnapshot string `json:"auth_project_id_snapshot,omitempty"`
	ResolvedModel         string `json:"resolved_model,omitempty"`
	InputTokens           int64  `json:"input_tokens"`
	OutputTokens          int64  `json:"output_tokens"`
	CachedTokens          int64  `json:"cached_tokens"`
	CacheReadTokens       int64  `json:"cache_read_tokens"`
	CacheCreationTokens   int64  `json:"cache_creation_tokens"`
	ReasoningTokens       int64  `json:"reasoning_tokens"`
	TotalTokens           int64  `json:"total_tokens"`
	LatencyMS             *int64 `json:"latency_ms"`
	Failed                bool   `json:"failed"`
	FailStatusCode        *int64 `json:"fail_status_code,omitempty"`
	FailSummary           string `json:"fail_summary,omitempty"`
}

type MonitoringAnalyticsEventsResponse struct {
	Items        []MonitoringAnalyticsEventRow `json:"items"`
	NextBeforeMS int64                         `json:"next_before_ms"`
	NextBeforeID *int64                        `json:"next_before_id,omitempty"`
	HasMore      bool                          `json:"has_more"`
	TotalCount   int64                         `json:"total_count,omitempty"`
}

type MonitoringAnalyticsResponse struct {
	GeneratedAtMS      int64                                        `json:"generated_at_ms"`
	Granularity        string                                       `json:"granularity"`
	Summary            *MonitoringAnalyticsSummary                  `json:"summary,omitempty"`
	SummaryComparison  *MonitoringAnalyticsSummaryComparison        `json:"summary_comparison,omitempty"`
	Timeline           []MonitoringAnalyticsTimelinePoint           `json:"timeline,omitempty"`
	HourlyDistribution []MonitoringAnalyticsHourlyPoint             `json:"hourly_distribution,omitempty"`
	Heatmap            []MonitoringAnalyticsHeatmapPoint            `json:"heatmap,omitempty"`
	AnomalyPoints      []any                                        `json:"anomaly_points,omitempty"`
	ModelShare         []MonitoringAnalyticsModelShareRow           `json:"model_share,omitempty"`
	ModelStats         []MonitoringAnalyticsModelStat               `json:"model_stats,omitempty"`
	ChannelShare       []MonitoringAnalyticsChannelShareRow         `json:"channel_share,omitempty"`
	AccountStats       []MonitoringAnalyticsAccountStatRow          `json:"account_stats,omitempty"`
	CredentialStats    []MonitoringAnalyticsCredentialStatRow       `json:"credential_stats,omitempty"`
	CredentialTimeline []MonitoringAnalyticsCredentialTimelinePoint `json:"credential_timeline,omitempty"`
	APIKeyStats        []MonitoringAnalyticsAPIKeyStatRow           `json:"api_key_stats,omitempty"`
	FilterOptions      *MonitoringAnalyticsFilterOptions            `json:"filter_options,omitempty"`
	TaskBuckets        []any                                        `json:"task_buckets,omitempty"`
	RecentFailures     []MonitoringAnalyticsEventRow                `json:"recent_failures,omitempty"`
	Events             *MonitoringAnalyticsEventsResponse           `json:"events,omitempty"`
	DrilldownPreview   *MonitoringAnalyticsEventsResponse           `json:"drilldown_preview,omitempty"`
}

type MonitoringAnalyticsHeatmapContributor struct {
	Key         string  `json:"key"`
	Label       string  `json:"label,omitempty"`
	Calls       int64   `json:"calls"`
	Success     int64   `json:"success"`
	Failure     int64   `json:"failure"`
	Tokens      int64   `json:"tokens"`
	Cost        float64 `json:"cost"`
	FailureRate float64 `json:"failure_rate"`
	Share       float64 `json:"share"`
}

type MonitoringAnalyticsHeatmapPoint struct {
	Weekday     int     `json:"weekday"`
	Hour        int     `json:"hour"`
	Calls       int64   `json:"calls"`
	Success     int64   `json:"success"`
	Failure     int64   `json:"failure"`
	Tokens      int64   `json:"tokens"`
	Cost        float64 `json:"cost"`
	FailureRate float64 `json:"failure_rate"`
}

type analyticsAggregate struct {
	Calls               int64
	SuccessCalls        int64
	FailureCalls        int64
	InputTokens         int64
	OutputTokens        int64
	CachedTokens        int64
	CacheCreationTokens int64
	ReasoningTokens     int64
	TotalTokens         int64
	LatencySumMS        int64
	LatencyCount        int64
	Latencies           []int64
	LastSeenMS          int64
	ZeroTokenCalls      int64
}

func (a *analyticsAggregate) add(event usage.Event) {
	a.Calls++
	if event.Failed {
		a.FailureCalls++
	} else {
		a.SuccessCalls++
	}
	a.InputTokens += event.InputTokens
	a.OutputTokens += event.OutputTokens
	a.CachedTokens += event.CachedTokens
	a.CacheCreationTokens += event.CacheTokens
	a.ReasoningTokens += event.ReasoningTokens
	a.TotalTokens += event.TotalTokens
	if event.TotalTokens == 0 {
		a.ZeroTokenCalls++
	}
	if event.LatencyMS != nil {
		a.LatencySumMS += *event.LatencyMS
		a.LatencyCount++
		a.Latencies = append(a.Latencies, *event.LatencyMS)
	}
	if event.TimestampMS > a.LastSeenMS {
		a.LastSeenMS = event.TimestampMS
	}
}

func (a analyticsAggregate) successRate() float64 {
	if a.Calls == 0 {
		return 0
	}
	return float64(a.SuccessCalls) / float64(a.Calls)
}

func (a analyticsAggregate) failureRate() float64 {
	if a.Calls == 0 {
		return 0
	}
	return float64(a.FailureCalls) / float64(a.Calls)
}

func (a analyticsAggregate) averageLatency() *int64 {
	if a.LatencyCount == 0 {
		return nil
	}
	value := a.LatencySumMS / a.LatencyCount
	return &value
}

func (a analyticsAggregate) p95Latency() *int64 {
	if len(a.Latencies) == 0 {
		return nil
	}
	values := append([]int64(nil), a.Latencies...)
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	index := int(math.Ceil(float64(len(values))*0.95)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(values) {
		index = len(values) - 1
	}
	value := values[index]
	return &value
}

func (s *Store) MonitoringAnalytics(ctx context.Context, request MonitoringAnalyticsRequest) (MonitoringAnalyticsResponse, error) {
	granularity := strings.ToLower(strings.TrimSpace(request.Include.Granularity))
	if granularity != "day" {
		granularity = "hour"
	}
	whereClause, args := request.monitoringAnalyticsWhereClause()
	events, err := s.queryEvents(ctx, whereClause, args, maxMonitoringAnalyticsEvents, 0)
	if err != nil {
		return MonitoringAnalyticsResponse{}, err
	}

	response := MonitoringAnalyticsResponse{
		GeneratedAtMS: time.Now().UnixMilli(),
		Granularity:   granularity,
	}
	summary := buildMonitoringAnalyticsSummary(events, request)
	if request.Include.Summary || request.Include.SummaryComparison || allMonitoringAnalyticsIncludesEmpty(request.Include) {
		response.Summary = &summary
	}
	if request.Include.SummaryComparison {
		response.SummaryComparison = buildMonitoringAnalyticsComparison(ctx, s, request)
	}
	if request.Include.Timeline {
		response.Timeline = buildMonitoringAnalyticsTimeline(events, granularity)
	}
	if request.Include.HourlyDistribution {
		response.HourlyDistribution = buildMonitoringAnalyticsHourlyDistribution(events)
	}
	modelStats := buildMonitoringAnalyticsModelStats(events)
	channelShare := buildMonitoringAnalyticsChannelShare(events)
	accountStats := buildMonitoringAnalyticsAccountStats(events)
	credentialStats := buildMonitoringAnalyticsCredentialStats(events)
	apiKeyStats := buildMonitoringAnalyticsAPIKeyStats(events)
	if request.Include.ModelStats {
		response.ModelStats = modelStats
	}
	if request.Include.ModelShare {
		response.ModelShare = buildMonitoringAnalyticsModelShare(modelStats)
	}
	if request.Include.ChannelShare {
		response.ChannelShare = channelShare
	}
	if request.Include.AccountStats {
		response.AccountStats = accountStats
	}
	if request.Include.CredentialStats {
		response.CredentialStats = credentialStats
	}
	if request.Include.CredentialTimeline {
		response.CredentialTimeline = buildMonitoringAnalyticsCredentialTimeline(events, granularity)
	}
	if request.Include.APIKeyStats {
		response.APIKeyStats = apiKeyStats
	}
	if request.Include.FilterOptions {
		response.FilterOptions = &MonitoringAnalyticsFilterOptions{
			AccountStats: accountStats,
			APIKeyStats:  apiKeyStats,
			ChannelShare: channelShare,
			ModelStats:   modelStats,
			Providers:    uniqueSorted(eventStrings(events, func(event usage.Event) string { return firstNonEmpty(event.AuthProviderSnapshot, event.Provider) })),
			AuthFiles:    uniqueSorted(eventStrings(events, func(event usage.Event) string { return event.AuthFileSnapshot })),
			ProjectIDs:   uniqueSorted(eventStrings(events, func(event usage.Event) string { return event.AuthProjectIDSnapshot })),
			RequestTypes: uniqueSorted(eventStrings(events, func(event usage.Event) string { return event.Endpoint })),
		}
	}
	if request.Include.Heatmap {
		response.Heatmap = buildMonitoringAnalyticsHeatmap(events)
	}
	if request.Include.AnomalyPoints {
		response.AnomalyPoints = []any{}
	}
	if request.Include.TaskBuckets {
		response.TaskBuckets = []any{}
	}
	if request.Include.RecentFailures > 0 {
		response.RecentFailures = buildMonitoringAnalyticsRecentFailures(events, request.Include.RecentFailures)
	}
	if request.Include.EventsPage != nil {
		page, err := s.monitoringAnalyticsEventsPage(ctx, request, *request.Include.EventsPage)
		if err != nil {
			return MonitoringAnalyticsResponse{}, err
		}
		response.Events = &page
	}
	if request.Include.DrilldownPreview != nil {
		previewRequest := request
		previewRequest.FromMS = request.Include.DrilldownPreview.FromMS
		previewRequest.ToMS = request.Include.DrilldownPreview.ToMS
		limit := request.Include.DrilldownPreview.Limit
		if limit <= 0 {
			limit = 12
		}
		page, err := s.monitoringAnalyticsEventsPage(ctx, previewRequest, MonitoringAnalyticsEventsPageRequest{Limit: limit})
		if err != nil {
			return MonitoringAnalyticsResponse{}, err
		}
		response.DrilldownPreview = &page
	}
	return response, nil
}

func allMonitoringAnalyticsIncludesEmpty(include MonitoringAnalyticsInclude) bool {
	return !include.Summary && !include.SummaryComparison && !include.Timeline &&
		!include.HourlyDistribution && !include.ModelShare && !include.ChannelShare &&
		!include.ModelStats && !include.FailureSources && !include.AccountStats &&
		!include.CredentialStats && !include.CredentialTimeline && !include.APIKeyStats &&
		!include.FilterOptions && !include.Heatmap && !include.AnomalyPoints &&
		!include.TaskBuckets && include.RecentFailures <= 0 && include.EventsPage == nil &&
		include.DrilldownPreview == nil
}

func (request MonitoringAnalyticsRequest) monitoringAnalyticsWhereClause() (string, []any) {
	clauses := []string{}
	args := []any{}
	if request.FromMS > 0 {
		clauses = append(clauses, "timestamp_ms >= ?")
		args = append(args, request.FromMS)
	}
	if request.ToMS > 0 {
		clauses = append(clauses, "timestamp_ms < ?")
		args = append(args, request.ToMS)
	}
	appendStringListClause := func(values []string, expression string) {
		normalized := normalizedLowerValues(values)
		if len(normalized) == 0 {
			return
		}
		placeholders := make([]string, len(normalized))
		for i, value := range normalized {
			placeholders[i] = "?"
			args = append(args, value)
		}
		clauses = append(clauses, expression+" in ("+strings.Join(placeholders, ",")+")")
	}
	appendStringListClause(request.Filters.Models, "lower(coalesce(nullif(resolved_model, ''), model, ''))")
	appendStringListClause(request.Filters.APIKeyHashes, "lower(coalesce(api_key_hash, ''))")
	appendStringListClause(request.Filters.AuthFiles, "lower(coalesce(auth_file_snapshot, ''))")
	appendStringListClause(request.Filters.AuthIndices, "lower(coalesce(auth_index, ''))")
	appendStringListClause(request.Filters.SourceHashes, "lower(coalesce(source_hash, ''))")
	appendStringListClause(request.Filters.ProjectIDs, "lower(coalesce(auth_project_id_snapshot, ''))")
	appendStringListClause(request.Filters.RequestTypes, "lower(coalesce(endpoint, ''))")
	if len(request.Filters.Providers) > 0 {
		normalized := normalizedLowerValues(request.Filters.Providers)
		if len(normalized) > 0 {
			placeholders := make([]string, len(normalized))
			for i := range normalized {
				placeholders[i] = "?"
			}
			joined := strings.Join(placeholders, ",")
			clauses = append(clauses, "(lower(coalesce(provider, '')) in ("+joined+") or lower(coalesce(auth_provider_snapshot, '')) in ("+joined+"))")
			args = append(args, repeatValues(normalized, 2)...)
		}
	}
	if len(request.Filters.Accounts) > 0 {
		normalized := normalizedLowerValues(request.Filters.Accounts)
		if len(normalized) > 0 {
			placeholders := make([]string, len(normalized))
			for i := range normalized {
				placeholders[i] = "?"
			}
			joined := strings.Join(placeholders, ",")
			clauses = append(clauses, "(lower(coalesce(account_snapshot, '')) in ("+joined+") or lower(coalesce(auth_label_snapshot, '')) in ("+joined+") or lower(coalesce(source, '')) in ("+joined+") or lower(coalesce(auth_index, '')) in ("+joined+"))")
			args = append(args, repeatValues(normalized, 4)...)
		}
	}
	if request.Filters.IncludeFailed != nil && !*request.Filters.IncludeFailed {
		clauses = append(clauses, "failed = 0")
	}
	if request.Filters.FailedOnly {
		clauses = append(clauses, "failed != 0")
	}
	if request.Filters.MinLatencyMS != nil {
		clauses = append(clauses, "latency_ms >= ?")
		args = append(args, *request.Filters.MinLatencyMS)
	}
	switch strings.ToLower(strings.TrimSpace(request.Filters.CacheStatus)) {
	case "hit":
		clauses = append(clauses, "(cached_tokens > 0 or cache_tokens > 0)")
	case "miss":
		clauses = append(clauses, "input_tokens > 0 and cached_tokens = 0 and cache_tokens = 0")
	}
	searchClause, searchArgs := (UsageSummaryFilter{
		Search:           request.SearchQuery,
		SearchAPIKeyHash: request.SearchAPIKeyHash,
	}).searchClause()
	if searchClause != "" {
		clauses = append(clauses, searchClause)
		args = append(args, searchArgs...)
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " where " + strings.Join(clauses, " and "), args
}

func normalizedLowerValues(values []string) []string {
	result := []string{}
	seen := map[string]struct{}{}
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" || normalized == "all" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result
}

func repeatValues(values []string, times int) []any {
	result := make([]any, 0, len(values)*times)
	for i := 0; i < times; i++ {
		for _, value := range values {
			result = append(result, value)
		}
	}
	return result
}

func buildMonitoringAnalyticsSummary(events []usage.Event, request MonitoringAnalyticsRequest) MonitoringAnalyticsSummary {
	var aggregate analyticsAggregate
	zeroTokenModels := map[string]struct{}{}
	nowMS := request.NowMS
	if nowMS <= 0 {
		nowMS = time.Now().UnixMilli()
	}
	cutoff30m := nowMS - 30*60*1000
	var calls30m, tokens30m int64
	for _, event := range events {
		aggregate.add(event)
		if event.TotalTokens == 0 {
			zeroTokenModels[analyticsModel(event)] = struct{}{}
		}
		if event.TimestampMS >= cutoff30m && event.TimestampMS <= nowMS {
			calls30m++
			tokens30m += event.TotalTokens
		}
	}
	rangeMS := request.ToMS - request.FromMS
	days := float64(rangeMS) / float64(24*time.Hour/time.Millisecond)
	if days <= 0 {
		days = 1
	}
	zeroModels := make([]string, 0, len(zeroTokenModels))
	for model := range zeroTokenModels {
		zeroModels = append(zeroModels, model)
	}
	sort.Strings(zeroModels)
	return MonitoringAnalyticsSummary{
		TotalCalls:            aggregate.Calls,
		SuccessCalls:          aggregate.SuccessCalls,
		FailureCalls:          aggregate.FailureCalls,
		SuccessRate:           aggregate.successRate(),
		InputTokens:           aggregate.InputTokens,
		OutputTokens:          aggregate.OutputTokens,
		CachedTokens:          aggregate.CachedTokens,
		CacheReadTokens:       aggregate.CachedTokens,
		CacheCreationTokens:   aggregate.CacheCreationTokens,
		ReasoningTokens:       aggregate.ReasoningTokens,
		TotalTokens:           aggregate.TotalTokens,
		AverageLatencyMS:      aggregate.averageLatency(),
		P95LatencyMS:          aggregate.p95Latency(),
		ZeroTokenCalls:        aggregate.ZeroTokenCalls,
		RPM30M:                float64(calls30m) / 30,
		TPM30M:                float64(tokens30m) / 30,
		AvgDailyRequests:      float64(aggregate.Calls) / days,
		AvgDailyTokens:        float64(aggregate.TotalTokens) / days,
		ApproxTasks:           aggregate.Calls,
		ApproxTaskFailures:    aggregate.FailureCalls,
		ApproxTaskSuccessRate: aggregate.successRate(),
		ZeroTokenModels:       zeroModels,
	}
}

func buildMonitoringAnalyticsComparison(ctx context.Context, s *Store, request MonitoringAnalyticsRequest) *MonitoringAnalyticsSummaryComparison {
	rangeMS := request.ToMS - request.FromMS
	if rangeMS <= 0 {
		return nil
	}
	previous := request
	previous.ToMS = request.FromMS
	previous.FromMS = request.FromMS - rangeMS
	whereClause, args := previous.monitoringAnalyticsWhereClause()
	events, err := s.queryEvents(ctx, whereClause, args, maxMonitoringAnalyticsEvents, 0)
	if err != nil {
		return nil
	}
	summary := buildMonitoringAnalyticsSummary(events, previous)
	return &MonitoringAnalyticsSummaryComparison{
		FromMS:       previous.FromMS,
		ToMS:         previous.ToMS,
		TotalCalls:   summary.TotalCalls,
		SuccessCalls: summary.SuccessCalls,
		FailureCalls: summary.FailureCalls,
		SuccessRate:  summary.SuccessRate,
		TotalTokens:  summary.TotalTokens,
		TotalCost:    summary.TotalCost,
	}
}

func buildMonitoringAnalyticsTimeline(events []usage.Event, granularity string) []MonitoringAnalyticsTimelinePoint {
	bucketSize := int64(time.Hour / time.Millisecond)
	if granularity == "day" {
		bucketSize = int64(24 * time.Hour / time.Millisecond)
	}
	byBucket := map[int64]*analyticsAggregate{}
	for _, event := range events {
		bucket := (event.TimestampMS / bucketSize) * bucketSize
		aggregate := byBucket[bucket]
		if aggregate == nil {
			aggregate = &analyticsAggregate{}
			byBucket[bucket] = aggregate
		}
		aggregate.add(event)
	}
	buckets := make([]int64, 0, len(byBucket))
	for bucket := range byBucket {
		buckets = append(buckets, bucket)
	}
	sort.Slice(buckets, func(i, j int) bool { return buckets[i] < buckets[j] })
	result := make([]MonitoringAnalyticsTimelinePoint, 0, len(buckets))
	for _, bucket := range buckets {
		aggregate := byBucket[bucket]
		result = append(result, MonitoringAnalyticsTimelinePoint{
			BucketMS:            bucket,
			BucketEndMS:         bucket + bucketSize,
			Label:               time.UnixMilli(bucket).UTC().Format(time.RFC3339),
			Calls:               aggregate.Calls,
			Tokens:              aggregate.TotalTokens,
			Success:             aggregate.SuccessCalls,
			Failure:             aggregate.FailureCalls,
			InputTokens:         aggregate.InputTokens,
			OutputTokens:        aggregate.OutputTokens,
			CachedTokens:        aggregate.CachedTokens,
			CacheReadTokens:     aggregate.CachedTokens,
			CacheCreationTokens: aggregate.CacheCreationTokens,
			ReasoningTokens:     aggregate.ReasoningTokens,
			TotalTokens:         aggregate.TotalTokens,
			AverageLatencyMS:    aggregate.averageLatency(),
			P95LatencyMS:        aggregate.p95Latency(),
			SuccessRate:         aggregate.successRate(),
			FailureRate:         aggregate.failureRate(),
		})
	}
	return result
}

func buildMonitoringAnalyticsHourlyDistribution(events []usage.Event) []MonitoringAnalyticsHourlyPoint {
	points := make([]MonitoringAnalyticsHourlyPoint, 24)
	for i := range points {
		points[i].Hour = i
	}
	for _, event := range events {
		hour := time.UnixMilli(event.TimestampMS).UTC().Hour()
		points[hour].Calls++
		points[hour].Tokens += event.TotalTokens
	}
	return points
}

func buildMonitoringAnalyticsModelStats(events []usage.Event) []MonitoringAnalyticsModelStat {
	byModel := map[string]*analyticsAggregate{}
	for _, event := range events {
		model := analyticsModel(event)
		if byModel[model] == nil {
			byModel[model] = &analyticsAggregate{}
		}
		byModel[model].add(event)
	}
	models := make([]string, 0, len(byModel))
	for model := range byModel {
		models = append(models, model)
	}
	sort.Slice(models, func(i, j int) bool {
		left, right := byModel[models[i]], byModel[models[j]]
		if left.Calls == right.Calls {
			return models[i] < models[j]
		}
		return left.Calls > right.Calls
	})
	result := make([]MonitoringAnalyticsModelStat, 0, len(models))
	for _, model := range models {
		aggregate := byModel[model]
		result = append(result, MonitoringAnalyticsModelStat{
			Model:               model,
			Calls:               aggregate.Calls,
			SuccessCalls:        aggregate.SuccessCalls,
			FailureCalls:        aggregate.FailureCalls,
			SuccessRate:         aggregate.successRate(),
			InputTokens:         aggregate.InputTokens,
			OutputTokens:        aggregate.OutputTokens,
			CachedTokens:        aggregate.CachedTokens,
			CacheReadTokens:     aggregate.CachedTokens,
			CacheCreationTokens: aggregate.CacheCreationTokens,
			TotalTokens:         aggregate.TotalTokens,
		})
	}
	return result
}

func buildMonitoringAnalyticsModelShare(stats []MonitoringAnalyticsModelStat) []MonitoringAnalyticsModelShareRow {
	result := make([]MonitoringAnalyticsModelShareRow, 0, len(stats))
	for _, row := range stats {
		result = append(result, MonitoringAnalyticsModelShareRow{
			Model:  row.Model,
			Calls:  row.Calls,
			Tokens: row.TotalTokens,
			Cost:   row.Cost,
		})
	}
	return result
}

func buildMonitoringAnalyticsChannelShare(events []usage.Event) []MonitoringAnalyticsChannelShareRow {
	type channelInfo struct {
		aggregate analyticsAggregate
		sample    usage.Event
	}
	byKey := map[string]*channelInfo{}
	for _, event := range events {
		key := firstNonEmpty(event.AuthIndex, event.Source, event.SourceHash, "-")
		entry := byKey[key]
		if entry == nil {
			entry = &channelInfo{sample: event}
			byKey[key] = entry
		}
		entry.aggregate.add(event)
	}
	keys := sortedAggregateKeys(byKey, func(info *channelInfo) analyticsAggregate { return info.aggregate })
	result := make([]MonitoringAnalyticsChannelShareRow, 0, len(keys))
	for _, key := range keys {
		entry := byKey[key]
		result = append(result, MonitoringAnalyticsChannelShareRow{
			AuthIndex:            entry.sample.AuthIndex,
			Source:               entry.sample.Source,
			AccountSnapshot:      entry.sample.AccountSnapshot,
			AuthLabelSnapshot:    entry.sample.AuthLabelSnapshot,
			AuthProviderSnapshot: entry.sample.AuthProviderSnapshot,
			Calls:                entry.aggregate.Calls,
			Success:              entry.aggregate.SuccessCalls,
			Failure:              entry.aggregate.FailureCalls,
			Tokens:               entry.aggregate.TotalTokens,
			AverageLatencyMS:     entry.aggregate.averageLatency(),
		})
	}
	return result
}

func buildMonitoringAnalyticsAccountStats(events []usage.Event) []MonitoringAnalyticsAccountStatRow {
	type accountInfo struct {
		aggregate analyticsAggregate
		sample    usage.Event
		auths     map[string]struct{}
		sources   map[string]struct{}
		hashes    map[string]struct{}
		models    map[string]*analyticsAggregate
	}
	byKey := map[string]*accountInfo{}
	for _, event := range events {
		key := firstNonEmpty(event.AccountSnapshot, event.AuthLabelSnapshot, event.Source, event.AuthIndex, event.SourceHash, "-")
		entry := byKey[key]
		if entry == nil {
			entry = &accountInfo{
				sample:  event,
				auths:   map[string]struct{}{},
				sources: map[string]struct{}{},
				hashes:  map[string]struct{}{},
				models:  map[string]*analyticsAggregate{},
			}
			byKey[key] = entry
		}
		entry.aggregate.add(event)
		addSetValue(entry.auths, event.AuthIndex)
		addSetValue(entry.sources, event.Source)
		addSetValue(entry.hashes, event.SourceHash)
		model := analyticsModel(event)
		if entry.models[model] == nil {
			entry.models[model] = &analyticsAggregate{}
		}
		entry.models[model].add(event)
	}
	keys := sortedAggregateKeys(byKey, func(info *accountInfo) analyticsAggregate { return info.aggregate })
	result := make([]MonitoringAnalyticsAccountStatRow, 0, len(keys))
	for _, key := range keys {
		entry := byKey[key]
		result = append(result, MonitoringAnalyticsAccountStatRow{
			ID:                   key,
			AccountSnapshot:      entry.sample.AccountSnapshot,
			AuthLabelSnapshot:    entry.sample.AuthLabelSnapshot,
			AuthProviderSnapshot: entry.sample.AuthProviderSnapshot,
			AuthIndices:          setValues(entry.auths),
			Sources:              setValues(entry.sources),
			SourceHashes:         setValues(entry.hashes),
			Calls:                entry.aggregate.Calls,
			SuccessCalls:         entry.aggregate.SuccessCalls,
			FailureCalls:         entry.aggregate.FailureCalls,
			SuccessRate:          entry.aggregate.successRate(),
			InputTokens:          entry.aggregate.InputTokens,
			OutputTokens:         entry.aggregate.OutputTokens,
			CachedTokens:         entry.aggregate.CachedTokens,
			CacheReadTokens:      entry.aggregate.CachedTokens,
			CacheCreationTokens:  entry.aggregate.CacheCreationTokens,
			TotalTokens:          entry.aggregate.TotalTokens,
			AverageLatencyMS:     entry.aggregate.averageLatency(),
			LastSeenMS:           entry.aggregate.LastSeenMS,
			Models:               buildMonitoringAnalyticsModelBreakdown(entry.models),
		})
	}
	return result
}

func buildMonitoringAnalyticsCredentialStats(events []usage.Event) []MonitoringAnalyticsCredentialStatRow {
	type credentialInfo struct {
		aggregate analyticsAggregate
		sample    usage.Event
		models    map[string]*analyticsAggregate
	}
	byKey := map[string]*credentialInfo{}
	for _, event := range events {
		key := firstNonEmpty(event.AuthFileSnapshot, event.AuthIndex, event.SourceHash, event.Source, "-")
		entry := byKey[key]
		if entry == nil {
			entry = &credentialInfo{sample: event, models: map[string]*analyticsAggregate{}}
			byKey[key] = entry
		}
		entry.aggregate.add(event)
		model := analyticsModel(event)
		if entry.models[model] == nil {
			entry.models[model] = &analyticsAggregate{}
		}
		entry.models[model].add(event)
	}
	keys := sortedAggregateKeys(byKey, func(info *credentialInfo) analyticsAggregate { return info.aggregate })
	result := make([]MonitoringAnalyticsCredentialStatRow, 0, len(keys))
	for _, key := range keys {
		entry := byKey[key]
		result = append(result, MonitoringAnalyticsCredentialStatRow{
			ID:                    key,
			AuthFileSnapshot:      entry.sample.AuthFileSnapshot,
			AuthIndex:             entry.sample.AuthIndex,
			Source:                entry.sample.Source,
			SourceHash:            entry.sample.SourceHash,
			AccountSnapshot:       entry.sample.AccountSnapshot,
			AuthLabelSnapshot:     entry.sample.AuthLabelSnapshot,
			AuthProviderSnapshot:  entry.sample.AuthProviderSnapshot,
			AuthProjectIDSnapshot: entry.sample.AuthProjectIDSnapshot,
			Calls:                 entry.aggregate.Calls,
			SuccessCalls:          entry.aggregate.SuccessCalls,
			FailureCalls:          entry.aggregate.FailureCalls,
			SuccessRate:           entry.aggregate.successRate(),
			InputTokens:           entry.aggregate.InputTokens,
			OutputTokens:          entry.aggregate.OutputTokens,
			CachedTokens:          entry.aggregate.CachedTokens,
			CacheReadTokens:       entry.aggregate.CachedTokens,
			CacheCreationTokens:   entry.aggregate.CacheCreationTokens,
			TotalTokens:           entry.aggregate.TotalTokens,
			AverageLatencyMS:      entry.aggregate.averageLatency(),
			LastSeenMS:            entry.aggregate.LastSeenMS,
			Models:                buildMonitoringAnalyticsModelBreakdown(entry.models),
		})
	}
	return result
}

func buildMonitoringAnalyticsAPIKeyStats(events []usage.Event) []MonitoringAnalyticsAPIKeyStatRow {
	type keyInfo struct {
		aggregate analyticsAggregate
		sample    usage.Event
		auths     map[string]struct{}
		sources   map[string]struct{}
		hashes    map[string]struct{}
		models    map[string]*analyticsAggregate
		contexts  map[string]*analyticsContextInfo
	}
	byKey := map[string]*keyInfo{}
	for _, event := range events {
		key := strings.ToLower(strings.TrimSpace(event.APIKeyHash))
		if key == "" {
			key = "-"
		}
		entry := byKey[key]
		if entry == nil {
			entry = &keyInfo{
				sample:   event,
				auths:    map[string]struct{}{},
				sources:  map[string]struct{}{},
				hashes:   map[string]struct{}{},
				models:   map[string]*analyticsAggregate{},
				contexts: map[string]*analyticsContextInfo{},
			}
			byKey[key] = entry
		}
		entry.aggregate.add(event)
		addSetValue(entry.auths, event.AuthIndex)
		addSetValue(entry.sources, event.Source)
		addSetValue(entry.hashes, event.SourceHash)
		model := analyticsModel(event)
		if entry.models[model] == nil {
			entry.models[model] = &analyticsAggregate{}
		}
		entry.models[model].add(event)
		contextKey := firstNonEmpty(event.AccountSnapshot, event.AuthLabelSnapshot, event.AuthIndex, event.SourceHash, event.Source, "-")
		if entry.contexts[contextKey] == nil {
			entry.contexts[contextKey] = &analyticsContextInfo{sample: event}
		}
		entry.contexts[contextKey].aggregate.add(event)
	}
	keys := sortedAggregateKeys(byKey, func(info *keyInfo) analyticsAggregate { return info.aggregate })
	result := make([]MonitoringAnalyticsAPIKeyStatRow, 0, len(keys))
	for _, key := range keys {
		entry := byKey[key]
		result = append(result, MonitoringAnalyticsAPIKeyStatRow{
			ID:                   key,
			APIKeyHash:           key,
			AccountSnapshot:      entry.sample.AccountSnapshot,
			AuthLabelSnapshot:    entry.sample.AuthLabelSnapshot,
			AuthProviderSnapshot: entry.sample.AuthProviderSnapshot,
			AuthIndices:          setValues(entry.auths),
			Sources:              setValues(entry.sources),
			SourceHashes:         setValues(entry.hashes),
			Calls:                entry.aggregate.Calls,
			SuccessCalls:         entry.aggregate.SuccessCalls,
			FailureCalls:         entry.aggregate.FailureCalls,
			SuccessRate:          entry.aggregate.successRate(),
			InputTokens:          entry.aggregate.InputTokens,
			OutputTokens:         entry.aggregate.OutputTokens,
			CachedTokens:         entry.aggregate.CachedTokens,
			CacheReadTokens:      entry.aggregate.CachedTokens,
			CacheCreationTokens:  entry.aggregate.CacheCreationTokens,
			TotalTokens:          entry.aggregate.TotalTokens,
			AverageLatencyMS:     entry.aggregate.averageLatency(),
			LastSeenMS:           entry.aggregate.LastSeenMS,
			Models:               buildMonitoringAnalyticsModelBreakdown(entry.models),
			Contexts:             buildMonitoringAnalyticsAPIKeyContexts(entry.contexts),
		})
	}
	return result
}

type analyticsContextInfo struct {
	aggregate analyticsAggregate
	sample    usage.Event
}

func buildMonitoringAnalyticsAPIKeyContexts(contexts map[string]*analyticsContextInfo) []MonitoringAnalyticsAPIKeyContextRow {
	keys := sortedAggregateKeys(contexts, func(info *analyticsContextInfo) analyticsAggregate { return info.aggregate })
	result := make([]MonitoringAnalyticsAPIKeyContextRow, 0, len(keys))
	for _, key := range keys {
		entry := contexts[key]
		result = append(result, MonitoringAnalyticsAPIKeyContextRow{
			ID:                   key,
			AccountSnapshot:      entry.sample.AccountSnapshot,
			AuthLabelSnapshot:    entry.sample.AuthLabelSnapshot,
			AuthProviderSnapshot: entry.sample.AuthProviderSnapshot,
			AuthIndex:            entry.sample.AuthIndex,
			Source:               entry.sample.Source,
			SourceHash:           entry.sample.SourceHash,
			Calls:                entry.aggregate.Calls,
			SuccessCalls:         entry.aggregate.SuccessCalls,
			FailureCalls:         entry.aggregate.FailureCalls,
			SuccessRate:          entry.aggregate.successRate(),
			FailureRate:          entry.aggregate.failureRate(),
			TotalTokens:          entry.aggregate.TotalTokens,
			AverageLatencyMS:     entry.aggregate.averageLatency(),
			LastSeenMS:           entry.aggregate.LastSeenMS,
		})
	}
	return result
}

func buildMonitoringAnalyticsModelBreakdown(models map[string]*analyticsAggregate) []MonitoringAnalyticsAccountModelStatRow {
	keys := make([]string, 0, len(models))
	for key := range models {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		left, right := models[keys[i]], models[keys[j]]
		if left.Calls == right.Calls {
			return keys[i] < keys[j]
		}
		return left.Calls > right.Calls
	})
	result := make([]MonitoringAnalyticsAccountModelStatRow, 0, len(keys))
	for _, key := range keys {
		aggregate := models[key]
		result = append(result, MonitoringAnalyticsAccountModelStatRow{
			Model:               key,
			Calls:               aggregate.Calls,
			SuccessCalls:        aggregate.SuccessCalls,
			FailureCalls:        aggregate.FailureCalls,
			SuccessRate:         aggregate.successRate(),
			InputTokens:         aggregate.InputTokens,
			OutputTokens:        aggregate.OutputTokens,
			CachedTokens:        aggregate.CachedTokens,
			CacheReadTokens:     aggregate.CachedTokens,
			CacheCreationTokens: aggregate.CacheCreationTokens,
			TotalTokens:         aggregate.TotalTokens,
			LastSeenMS:          aggregate.LastSeenMS,
		})
	}
	return result
}

func buildMonitoringAnalyticsCredentialTimeline(events []usage.Event, granularity string) []MonitoringAnalyticsCredentialTimelinePoint {
	bucketSize := int64(time.Hour / time.Millisecond)
	if granularity == "day" {
		bucketSize = int64(24 * time.Hour / time.Millisecond)
	}
	type key struct {
		id     string
		bucket int64
	}
	type item struct {
		aggregate analyticsAggregate
		sample    usage.Event
	}
	byKey := map[key]*item{}
	for _, event := range events {
		id := firstNonEmpty(event.AuthFileSnapshot, event.AuthIndex, event.SourceHash, event.Source, "-")
		bucket := (event.TimestampMS / bucketSize) * bucketSize
		k := key{id: id, bucket: bucket}
		entry := byKey[k]
		if entry == nil {
			entry = &item{sample: event}
			byKey[k] = entry
		}
		entry.aggregate.add(event)
	}
	keys := make([]key, 0, len(byKey))
	for k := range byKey {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].bucket == keys[j].bucket {
			return keys[i].id < keys[j].id
		}
		return keys[i].bucket < keys[j].bucket
	})
	result := make([]MonitoringAnalyticsCredentialTimelinePoint, 0, len(keys))
	for _, k := range keys {
		entry := byKey[k]
		result = append(result, MonitoringAnalyticsCredentialTimelinePoint{
			ID:                   k.id,
			Label:                firstNonEmpty(entry.sample.AuthLabelSnapshot, entry.sample.AccountSnapshot, entry.sample.Source, k.id),
			AuthFileSnapshot:     entry.sample.AuthFileSnapshot,
			AuthIndex:            entry.sample.AuthIndex,
			Source:               entry.sample.Source,
			SourceHash:           entry.sample.SourceHash,
			AccountSnapshot:      entry.sample.AccountSnapshot,
			AuthLabelSnapshot:    entry.sample.AuthLabelSnapshot,
			AuthProviderSnapshot: entry.sample.AuthProviderSnapshot,
			BucketMS:             k.bucket,
			BucketLabel:          time.UnixMilli(k.bucket).UTC().Format(time.RFC3339),
			Calls:                entry.aggregate.Calls,
			Tokens:               entry.aggregate.TotalTokens,
			Success:              entry.aggregate.SuccessCalls,
			Failure:              entry.aggregate.FailureCalls,
			InputTokens:          entry.aggregate.InputTokens,
			OutputTokens:         entry.aggregate.OutputTokens,
			CachedTokens:         entry.aggregate.CachedTokens,
			CacheReadTokens:      entry.aggregate.CachedTokens,
			CacheCreationTokens:  entry.aggregate.CacheCreationTokens,
			ReasoningTokens:      entry.aggregate.ReasoningTokens,
			TotalTokens:          entry.aggregate.TotalTokens,
			AverageLatencyMS:     entry.aggregate.averageLatency(),
			SuccessRate:          entry.aggregate.successRate(),
			FailureRate:          entry.aggregate.failureRate(),
		})
	}
	return result
}

func buildMonitoringAnalyticsHeatmap(events []usage.Event) []MonitoringAnalyticsHeatmapPoint {
	type key struct {
		weekday int
		hour    int
	}
	byKey := map[key]*analyticsAggregate{}
	for _, event := range events {
		t := time.UnixMilli(event.TimestampMS).UTC()
		k := key{weekday: int(t.Weekday()), hour: t.Hour()}
		if byKey[k] == nil {
			byKey[k] = &analyticsAggregate{}
		}
		byKey[k].add(event)
	}
	keys := make([]key, 0, len(byKey))
	for k := range byKey {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].weekday == keys[j].weekday {
			return keys[i].hour < keys[j].hour
		}
		return keys[i].weekday < keys[j].weekday
	})
	result := make([]MonitoringAnalyticsHeatmapPoint, 0, len(keys))
	for _, k := range keys {
		aggregate := byKey[k]
		result = append(result, MonitoringAnalyticsHeatmapPoint{
			Weekday:     k.weekday,
			Hour:        k.hour,
			Calls:       aggregate.Calls,
			Success:     aggregate.SuccessCalls,
			Failure:     aggregate.FailureCalls,
			Tokens:      aggregate.TotalTokens,
			FailureRate: aggregate.failureRate(),
		})
	}
	return result
}

func buildMonitoringAnalyticsRecentFailures(events []usage.Event, limit int) []MonitoringAnalyticsEventRow {
	result := []MonitoringAnalyticsEventRow{}
	for _, event := range events {
		if !event.Failed {
			continue
		}
		result = append(result, monitoringAnalyticsEventRow(event))
		if len(result) >= limit {
			break
		}
	}
	return result
}

func (s *Store) monitoringAnalyticsEventsPage(ctx context.Context, request MonitoringAnalyticsRequest, page MonitoringAnalyticsEventsPageRequest) (MonitoringAnalyticsEventsResponse, error) {
	if page.Limit <= 0 {
		page.Limit = 100
	}
	if page.Limit > MaxUsagePageSize {
		page.Limit = MaxUsagePageSize
	}
	whereClause, args := request.monitoringAnalyticsWhereClause()
	totalCount, err := s.countUsageEvents(ctx, whereClause, args)
	if err != nil {
		return MonitoringAnalyticsEventsResponse{}, err
	}
	if page.BeforeMS != nil && *page.BeforeMS > 0 {
		whereClause, args = appendWhereCondition(whereClause, args, "timestamp_ms < ?", *page.BeforeMS)
	}
	events, err := s.queryEvents(ctx, whereClause, args, page.Limit+1, 0)
	if err != nil {
		return MonitoringAnalyticsEventsResponse{}, err
	}
	hasMore := len(events) > page.Limit
	if hasMore {
		events = events[:page.Limit]
	}
	items := make([]MonitoringAnalyticsEventRow, 0, len(events))
	var nextBeforeMS int64
	for _, event := range events {
		items = append(items, monitoringAnalyticsEventRow(event))
		nextBeforeMS = event.TimestampMS
	}
	return MonitoringAnalyticsEventsResponse{
		Items:        items,
		NextBeforeMS: nextBeforeMS,
		HasMore:      hasMore,
		TotalCount:   totalCount,
	}, nil
}

func (s *Store) countUsageEvents(ctx context.Context, whereClause string, args []any) (int64, error) {
	var count int64
	if err := s.db.QueryRowContext(ctx, `select count(*) from usage_events`+whereClause, args...).Scan(&count); err != nil {
		if err == sql.ErrNoRows {
			return 0, nil
		}
		return 0, err
	}
	return count, nil
}

func appendWhereCondition(whereClause string, args []any, condition string, values ...any) (string, []any) {
	if strings.TrimSpace(whereClause) == "" {
		whereClause = " where " + condition
	} else {
		whereClause += " and " + condition
	}
	return whereClause, append(args, values...)
}

func monitoringAnalyticsEventRow(event usage.Event) MonitoringAnalyticsEventRow {
	statusCode, failSummary := readFailureMetadata(event.RawJSON)
	return MonitoringAnalyticsEventRow{
		RequestID:             event.RequestID,
		EventHash:             event.EventHash,
		TimestampMS:           event.TimestampMS,
		Model:                 firstNonEmpty(event.RequestedModel, event.Model, event.ResolvedModel, "-"),
		Endpoint:              event.Endpoint,
		Method:                event.Method,
		Path:                  event.Path,
		AuthIndex:             event.AuthIndex,
		Source:                event.Source,
		SourceHash:            event.SourceHash,
		APIKeyHash:            event.APIKeyHash,
		AccountSnapshot:       event.AccountSnapshot,
		AuthLabelSnapshot:     event.AuthLabelSnapshot,
		AuthFileSnapshot:      event.AuthFileSnapshot,
		AuthProviderSnapshot:  event.AuthProviderSnapshot,
		AuthProjectIDSnapshot: event.AuthProjectIDSnapshot,
		ResolvedModel:         event.ResolvedModel,
		InputTokens:           event.InputTokens,
		OutputTokens:          event.OutputTokens,
		CachedTokens:          event.CachedTokens,
		CacheReadTokens:       event.CachedTokens,
		CacheCreationTokens:   event.CacheTokens,
		ReasoningTokens:       event.ReasoningTokens,
		TotalTokens:           event.TotalTokens,
		LatencyMS:             event.LatencyMS,
		Failed:                event.Failed,
		FailStatusCode:        statusCode,
		FailSummary:           failSummary,
	}
}

func readFailureMetadata(raw string) (*int64, string) {
	if strings.TrimSpace(raw) == "" {
		return nil, ""
	}
	var record map[string]any
	if err := json.Unmarshal([]byte(raw), &record); err != nil {
		return nil, ""
	}
	var statusCode *int64
	for _, key := range []string{"status", "status_code", "statusCode", "fail_status_code", "failStatusCode"} {
		if value, ok := readJSONInt(record[key]); ok {
			statusCode = &value
			break
		}
	}
	for _, key := range []string{"error", "message", "fail_summary", "failSummary"} {
		if value, ok := record[key].(string); ok && strings.TrimSpace(value) != "" {
			return statusCode, value
		}
	}
	return statusCode, ""
}

func readJSONInt(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		return int64(typed), true
	case int64:
		return typed, true
	case int:
		return int64(typed), true
	default:
		return 0, false
	}
}

func analyticsModel(event usage.Event) string {
	return firstNonEmpty(event.ResolvedModel, event.Model, event.RequestedModel, "-")
}

func eventStrings(events []usage.Event, read func(usage.Event) string) []string {
	values := make([]string, 0, len(events))
	for _, event := range events {
		values = append(values, read(event))
	}
	return values
}

func uniqueSorted(values []string) []string {
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || trimmed == "-" {
			continue
		}
		seen[trimmed] = struct{}{}
	}
	result := make([]string, 0, len(seen))
	for value := range seen {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func addSetValue(set map[string]struct{}, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}
	set[value] = struct{}{}
}

func setValues(set map[string]struct{}) []string {
	values := make([]string, 0, len(set))
	for value := range set {
		values = append(values, value)
	}
	sort.Strings(values)
	return values
}

func sortedAggregateKeys[T any](items map[string]*T, readAggregate func(*T) analyticsAggregate) []string {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		left, right := readAggregate(items[keys[i]]), readAggregate(items[keys[j]])
		if left.Calls == right.Calls {
			return keys[i] < keys[j]
		}
		return left.Calls > right.Calls
	})
	return keys
}
