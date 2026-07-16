package usagehourly

import (
	"context"
	"fmt"
	"log"
	"sort"
	"sync/atomic"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

const (
	hourMS                    = int64(time.Hour / time.Millisecond)
	fallbackLogIntervalMS     = int64(5 * time.Minute / time.Millisecond)
	defaultFallbackLogContext = "usage-hourly-rollup"
)

type Reader struct {
	store              *store.Store
	enabled            bool
	lastFallbackLogMS  atomic.Int64
	fallbackLogContext string
}

type Snapshot struct {
	Aggregate  store.Aggregate
	ModelStats []store.ModelStat

	rows                   []store.DashboardHourlyRollupRow
	edges                  []timeRange
	fullStartMS            int64
	fullEndMS              int64
	dashboardTimelineReady bool
	analyticsTimelineReady bool
}

type timeRange struct {
	fromMS int64
	toMS   int64
}

type modelStatKey struct {
	model        string
	billingModel string
	serviceTier  string
}

type analyticsTimelineKey struct {
	bucketMS     int64
	model        string
	billingModel string
	serviceTier  string
}

func New(store *store.Store, enabled bool, logContext ...string) *Reader {
	contextName := defaultFallbackLogContext
	if len(logContext) > 0 && logContext[0] != "" {
		contextName = logContext[0]
	}
	return &Reader{
		store:              store,
		enabled:            enabled,
		fallbackLogContext: contextName,
	}
}

func (r *Reader) Load(ctx context.Context, fromMS, toMS int64) (Snapshot, bool) {
	return r.loadRows(ctx, fromMS, toMS, r.store.DashboardHourlyRollupRows, true, true)
}

func (r *Reader) LoadAnalytics(
	ctx context.Context,
	fromMS int64,
	toMS int64,
	granularity string,
	location *time.Location,
	needsTimeline bool,
) (Snapshot, bool) {
	if needsTimeline {
		if granularity != "day" || location == nil || location.String() != "UTC" {
			return r.Load(ctx, fromMS, toMS)
		}
		return r.loadRows(ctx, fromMS, toMS, r.store.DashboardDailyRollupRows, false, true)
	}
	return r.loadRows(ctx, fromMS, toMS, r.store.DashboardHourlyRollupModelRows, false, false)
}

type rowLoader func(context.Context, int64, int64) ([]store.DashboardHourlyRollupRow, error)

func (r *Reader) loadRows(
	ctx context.Context,
	fromMS int64,
	toMS int64,
	load rowLoader,
	dashboardTimelineReady bool,
	analyticsTimelineReady bool,
) (Snapshot, bool) {
	if !r.enabled {
		return Snapshot{}, false
	}
	if fromMS >= toMS {
		return Snapshot{
			ModelStats: []store.ModelStat{},
		}, true
	}
	fullStartMS := ceilHourMS(fromMS)
	fullEndMS := floorHourMS(toMS)
	if fullStartMS >= fullEndMS {
		return Snapshot{}, false
	}

	checkpoint, err := r.store.DashboardHourlyRollupCheckpoint(ctx)
	if err != nil {
		r.logFallback(fmt.Sprintf("checkpoint query failed: %v", err))
		return Snapshot{}, false
	}
	latestID, err := r.store.LatestUsageEventID(ctx)
	if err != nil {
		r.logFallback(fmt.Sprintf("latest event query failed: %v", err))
		return Snapshot{}, false
	}
	if checkpoint.LastEventID < latestID {
		r.logFallback(fmt.Sprintf("checkpoint pending: last_event_id=%d latest_event_id=%d", checkpoint.LastEventID, latestID))
		return Snapshot{}, false
	}

	rows, err := load(ctx, fullStartMS, fullEndMS)
	if err != nil {
		r.logFallback(fmt.Sprintf("hourly rows query failed: %v", err))
		return Snapshot{}, false
	}
	agg, modelStats := coreFromRows(rows)
	edges := rawEdges(fromMS, toMS, fullStartMS, fullEndMS)
	for _, edge := range edges {
		edgeAgg, err := r.store.AggregateBetween(ctx, edge.fromMS, edge.toMS)
		if err != nil {
			r.logFallback(fmt.Sprintf("raw edge aggregate failed: %v", err))
			return Snapshot{}, false
		}
		edgeModels, err := r.store.ModelStatsBetween(ctx, edge.fromMS, edge.toMS)
		if err != nil {
			r.logFallback(fmt.Sprintf("raw edge model query failed: %v", err))
			return Snapshot{}, false
		}
		agg = mergeAggregates(agg, edgeAgg)
		modelStats = mergeModelStats(modelStats, edgeModels)
	}

	return Snapshot{
		Aggregate:              agg,
		ModelStats:             modelStats,
		rows:                   rows,
		edges:                  edges,
		fullStartMS:            fullStartMS,
		fullEndMS:              fullEndMS,
		dashboardTimelineReady: dashboardTimelineReady,
		analyticsTimelineReady: analyticsTimelineReady,
	}, true
}

func (r *Reader) DashboardTimeline(ctx context.Context, snapshot Snapshot, fromMS, toMS int64) ([]store.TimelinePoint, bool) {
	if !snapshot.dashboardTimelineReady {
		return nil, false
	}
	if fromMS%hourMS != 0 {
		timeline, err := r.store.HourlyTimelineBetween(ctx, fromMS, toMS)
		if err != nil {
			r.logFallback(fmt.Sprintf("offset timeline query failed: %v", err))
			return nil, false
		}
		return timeline, true
	}

	timeline := dashboardTimelineFromRows(snapshot.rows)
	if snapshot.fullEndMS < toMS {
		edgeTimeline, err := r.store.HourlyTimelineBetween(ctx, snapshot.fullEndMS, toMS)
		if err != nil {
			r.logFallback(fmt.Sprintf("raw edge timeline query failed: %v", err))
			return nil, false
		}
		timeline = mergeDashboardTimeline(timeline, edgeTimeline)
	}
	return timeline, true
}

func (r *Reader) AnalyticsTimeline(
	ctx context.Context,
	snapshot Snapshot,
	granularity string,
	location *time.Location,
) ([]store.TimelinePoint, bool) {
	if !snapshot.analyticsTimelineReady {
		return nil, false
	}
	if location == nil {
		location = time.UTC
	}
	if granularity != "day" {
		granularity = "hour"
	}
	if !usage.CanMapUTCWholeHours(snapshot.fullStartMS, snapshot.fullEndMS, granularity, location) {
		return nil, false
	}

	timeline := analyticsTimelineFromRows(snapshot.rows, granularity, location)
	for _, edge := range snapshot.edges {
		filter := store.AnalyticsFilter{
			FromMS:        edge.fromMS,
			ToMS:          edge.toMS,
			IncludeFailed: true,
		}
		edgeTimeline, err := r.store.TimelineWithFilter(ctx, filter, granularity, location)
		if err != nil {
			r.logFallback(fmt.Sprintf("analytics raw edge timeline query failed: %v", err))
			return nil, false
		}
		timeline = mergeAnalyticsTimeline(timeline, edgeTimeline)
	}
	return timeline, true
}

// CanRepresentAnalyticsTimeline reports whether complete UTC hourly rows can
// be mapped to the requested local buckets without splitting an hourly row.
func (r *Reader) CanRepresentAnalyticsTimeline(fromMS, toMS int64, granularity string, location *time.Location) bool {
	if !r.enabled {
		return false
	}
	if location == nil {
		location = time.UTC
	}
	if granularity != "day" {
		granularity = "hour"
	}
	fullStartMS := ceilHourMS(fromMS)
	fullEndMS := floorHourMS(toMS)
	return fullStartMS < fullEndMS && usage.CanMapUTCWholeHours(fullStartMS, fullEndMS, granularity, location)
}

func rawEdges(fromMS, toMS, fullStartMS, fullEndMS int64) []timeRange {
	ranges := make([]timeRange, 0, 2)
	if fromMS < fullStartMS {
		ranges = append(ranges, timeRange{fromMS: fromMS, toMS: min(fullStartMS, toMS)})
	}
	if fullEndMS < toMS {
		ranges = append(ranges, timeRange{fromMS: max(fullEndMS, fromMS), toMS: toMS})
	}
	return ranges
}

func ceilHourMS(value int64) int64 {
	if value%hourMS == 0 {
		return value
	}
	return value - value%hourMS + hourMS
}

func floorHourMS(value int64) int64 {
	return value - value%hourMS
}

func coreFromRows(rows []store.DashboardHourlyRollupRow) (store.Aggregate, []store.ModelStat) {
	agg := store.Aggregate{}
	modelStats := make(map[modelStatKey]*store.ModelStat)
	var latencySum int64
	for _, row := range rows {
		agg.TotalCalls += row.Calls
		agg.SuccessCalls += row.SuccessCalls
		agg.FailureCalls += row.FailureCalls
		agg.InputTokens += row.InputTokens
		agg.OutputTokens += row.OutputTokens
		agg.ReasoningTokens += row.ReasoningTokens
		agg.CachedTokens += row.CachedTokens
		agg.CacheReadTokens += row.CacheReadTokens
		agg.CacheCreationTokens += row.CacheCreationTokens
		agg.LongInputTokens += row.LongInputTokens
		agg.LongOutputTokens += row.LongOutputTokens
		agg.LongCachedTokens += row.LongCachedTokens
		agg.LongCacheReadTokens += row.LongCacheReadTokens
		agg.LongCacheCreationTokens += row.LongCacheCreationTokens
		agg.TotalTokens += row.TotalTokens
		agg.LatencySamples += row.LatencySamples
		agg.ZeroTokenCalls += row.ZeroTokenCalls
		latencySum += row.LatencySumMS
		addModelStat(modelStats, store.ModelStat{
			Model:               row.Model,
			BillingModel:        row.BillingModel,
			ServiceTier:         row.ServiceTier,
			Calls:               row.Calls,
			SuccessCalls:        row.SuccessCalls,
			InputTokens:         row.InputTokens,
			OutputTokens:        row.OutputTokens,
			ReasoningTokens:     row.ReasoningTokens,
			CachedTokens:        row.CachedTokens,
			CacheReadTokens:     row.CacheReadTokens,
			CacheCreationTokens: row.CacheCreationTokens,
			LongContextTokens:   row.LongContextTokens,
			TotalTokens:         row.TotalTokens,
		})
	}
	if agg.LatencySamples > 0 {
		agg.AvgLatencyMS.Valid = true
		agg.AvgLatencyMS.Float64 = float64(latencySum) / float64(agg.LatencySamples)
	}
	return agg, sortedModelStats(modelStats)
}

func mergeAggregates(left, right store.Aggregate) store.Aggregate {
	latencySum := left.AvgLatencyMS.Float64*float64(left.LatencySamples) + right.AvgLatencyMS.Float64*float64(right.LatencySamples)
	left.TotalCalls += right.TotalCalls
	left.SuccessCalls += right.SuccessCalls
	left.FailureCalls += right.FailureCalls
	left.InputTokens += right.InputTokens
	left.OutputTokens += right.OutputTokens
	left.ReasoningTokens += right.ReasoningTokens
	left.CachedTokens += right.CachedTokens
	left.CacheReadTokens += right.CacheReadTokens
	left.CacheCreationTokens += right.CacheCreationTokens
	left.LongInputTokens += right.LongInputTokens
	left.LongOutputTokens += right.LongOutputTokens
	left.LongCachedTokens += right.LongCachedTokens
	left.LongCacheReadTokens += right.LongCacheReadTokens
	left.LongCacheCreationTokens += right.LongCacheCreationTokens
	left.TotalTokens += right.TotalTokens
	left.LatencySamples += right.LatencySamples
	left.ZeroTokenCalls += right.ZeroTokenCalls
	left.AvgLatencyMS.Valid = left.LatencySamples > 0
	if left.AvgLatencyMS.Valid {
		left.AvgLatencyMS.Float64 = latencySum / float64(left.LatencySamples)
	}
	return left
}

func mergeModelStats(left, right []store.ModelStat) []store.ModelStat {
	grouped := make(map[modelStatKey]*store.ModelStat, len(left)+len(right))
	for _, stat := range left {
		addModelStat(grouped, stat)
	}
	for _, stat := range right {
		addModelStat(grouped, stat)
	}
	return sortedModelStats(grouped)
}

func addModelStat(grouped map[modelStatKey]*store.ModelStat, stat store.ModelStat) {
	mapKey := modelStatKey{model: stat.Model, billingModel: stat.BillingModel, serviceTier: stat.ServiceTier}
	entry := grouped[mapKey]
	if entry == nil {
		copy := stat
		grouped[mapKey] = &copy
		return
	}
	entry.Calls += stat.Calls
	entry.SuccessCalls += stat.SuccessCalls
	entry.InputTokens += stat.InputTokens
	entry.OutputTokens += stat.OutputTokens
	entry.ReasoningTokens += stat.ReasoningTokens
	entry.CachedTokens += stat.CachedTokens
	entry.CacheReadTokens += stat.CacheReadTokens
	entry.CacheCreationTokens += stat.CacheCreationTokens
	entry.LongInputTokens += stat.LongInputTokens
	entry.LongOutputTokens += stat.LongOutputTokens
	entry.LongCachedTokens += stat.LongCachedTokens
	entry.LongCacheReadTokens += stat.LongCacheReadTokens
	entry.LongCacheCreationTokens += stat.LongCacheCreationTokens
	entry.TotalTokens += stat.TotalTokens
}

func sortedModelStats(grouped map[modelStatKey]*store.ModelStat) []store.ModelStat {
	result := make([]store.ModelStat, 0, len(grouped))
	for _, stat := range grouped {
		result = append(result, *stat)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Calls != result[j].Calls {
			return result[i].Calls > result[j].Calls
		}
		if result[i].Model != result[j].Model {
			return result[i].Model < result[j].Model
		}
		if result[i].BillingModel != result[j].BillingModel {
			return result[i].BillingModel < result[j].BillingModel
		}
		return result[i].ServiceTier < result[j].ServiceTier
	})
	return result
}

func dashboardTimelineFromRows(rows []store.DashboardHourlyRollupRow) []store.TimelinePoint {
	grouped := make(map[int64]*store.TimelinePoint)
	for _, row := range rows {
		point := grouped[row.BucketMS]
		if point == nil {
			point = &store.TimelinePoint{BucketMS: row.BucketMS}
			grouped[row.BucketMS] = point
		}
		point.Calls += row.Calls
		point.Tokens += row.TotalTokens
		point.Success += row.SuccessCalls
		point.Failure += row.FailureCalls
	}
	result := make([]store.TimelinePoint, 0, len(grouped))
	for _, point := range grouped {
		result = append(result, *point)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].BucketMS < result[j].BucketMS })
	return result
}

func mergeDashboardTimeline(left, right []store.TimelinePoint) []store.TimelinePoint {
	grouped := make(map[int64]*store.TimelinePoint, len(left)+len(right))
	add := func(point store.TimelinePoint) {
		entry := grouped[point.BucketMS]
		if entry == nil {
			copy := point
			grouped[point.BucketMS] = &copy
			return
		}
		entry.Calls += point.Calls
		entry.Tokens += point.Tokens
		entry.Success += point.Success
		entry.Failure += point.Failure
	}
	for _, point := range left {
		add(point)
	}
	for _, point := range right {
		add(point)
	}
	result := make([]store.TimelinePoint, 0, len(grouped))
	for _, point := range grouped {
		result = append(result, *point)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].BucketMS < result[j].BucketMS })
	return result
}

func analyticsTimelineFromRows(rows []store.DashboardHourlyRollupRow, granularity string, location *time.Location) []store.TimelinePoint {
	grouped := make(map[analyticsTimelineKey]*store.TimelinePoint)
	for _, row := range rows {
		point := store.TimelinePoint{
			LongContextTokens:   row.LongContextTokens,
			BucketMS:            usage.AnalyticsBucketMS(row.BucketMS, granularity, location),
			Model:               row.Model,
			BillingModel:        row.BillingModel,
			ServiceTier:         row.ServiceTier,
			Calls:               row.Calls,
			Tokens:              row.TotalTokens,
			Success:             row.SuccessCalls,
			Failure:             row.FailureCalls,
			InputTokens:         row.InputTokens,
			OutputTokens:        row.OutputTokens,
			ReasoningTokens:     row.ReasoningTokens,
			CachedTokens:        row.CachedTokens,
			CacheReadTokens:     row.CacheReadTokens,
			CacheCreationTokens: row.CacheCreationTokens,
			LatencySamples:      row.LatencySamples,
		}
		if row.LatencySamples > 0 {
			point.AvgLatencyMS.Valid = true
			point.AvgLatencyMS.Float64 = float64(row.LatencySumMS) / float64(row.LatencySamples)
		}
		addAnalyticsTimelinePoint(grouped, point)
	}
	return sortedAnalyticsTimeline(grouped)
}

func mergeAnalyticsTimeline(left, right []store.TimelinePoint) []store.TimelinePoint {
	grouped := make(map[analyticsTimelineKey]*store.TimelinePoint, len(left)+len(right))
	for _, point := range left {
		addAnalyticsTimelinePoint(grouped, point)
	}
	for _, point := range right {
		addAnalyticsTimelinePoint(grouped, point)
	}
	return sortedAnalyticsTimeline(grouped)
}

func addAnalyticsTimelinePoint(grouped map[analyticsTimelineKey]*store.TimelinePoint, point store.TimelinePoint) {
	mapKey := analyticsTimelineKey{
		bucketMS:     point.BucketMS,
		model:        point.Model,
		billingModel: point.BillingModel,
		serviceTier:  point.ServiceTier,
	}
	entry := grouped[mapKey]
	if entry == nil {
		copy := point
		grouped[mapKey] = &copy
		return
	}
	latencyTotal := entry.AvgLatencyMS.Float64*float64(entry.LatencySamples) + point.AvgLatencyMS.Float64*float64(point.LatencySamples)
	entry.Calls += point.Calls
	entry.Tokens += point.Tokens
	entry.Success += point.Success
	entry.Failure += point.Failure
	entry.InputTokens += point.InputTokens
	entry.OutputTokens += point.OutputTokens
	entry.ReasoningTokens += point.ReasoningTokens
	entry.CachedTokens += point.CachedTokens
	entry.CacheReadTokens += point.CacheReadTokens
	entry.CacheCreationTokens += point.CacheCreationTokens
	entry.LongInputTokens += point.LongInputTokens
	entry.LongOutputTokens += point.LongOutputTokens
	entry.LongCachedTokens += point.LongCachedTokens
	entry.LongCacheReadTokens += point.LongCacheReadTokens
	entry.LongCacheCreationTokens += point.LongCacheCreationTokens
	entry.LatencySamples += point.LatencySamples
	entry.AvgLatencyMS.Valid = entry.LatencySamples > 0
	if entry.AvgLatencyMS.Valid {
		entry.AvgLatencyMS.Float64 = latencyTotal / float64(entry.LatencySamples)
	}
}

func sortedAnalyticsTimeline(grouped map[analyticsTimelineKey]*store.TimelinePoint) []store.TimelinePoint {
	result := make([]store.TimelinePoint, 0, len(grouped))
	for _, point := range grouped {
		result = append(result, *point)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].BucketMS != result[j].BucketMS {
			return result[i].BucketMS < result[j].BucketMS
		}
		if result[i].Model != result[j].Model {
			return result[i].Model < result[j].Model
		}
		if result[i].BillingModel != result[j].BillingModel {
			return result[i].BillingModel < result[j].BillingModel
		}
		return result[i].ServiceTier < result[j].ServiceTier
	})
	return result
}

func (r *Reader) logFallback(reason string) {
	nowMS := time.Now().UnixMilli()
	for {
		lastMS := r.lastFallbackLogMS.Load()
		if lastMS > 0 && nowMS-lastMS < fallbackLogIntervalMS {
			return
		}
		if r.lastFallbackLogMS.CompareAndSwap(lastMS, nowMS) {
			log.Printf("[%s] falling back to raw usage events: %s", r.fallbackLogContext, reason)
			return
		}
	}
}
