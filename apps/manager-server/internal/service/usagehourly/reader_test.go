package usagehourly

import (
	"context"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

func TestReaderMatchesRawCoreAndTimelines(t *testing.T) {
	db := newReaderTestStore(t)
	ctx := context.Background()
	fromMS := int64(1_800_000_000_000) + 15*60*1000
	toMS := fromMS + 3*hourMS + 20*60*1000
	latency100 := int64(100)
	latency300 := int64(300)

	first := readerEvent("reader-first", fromMS+10*60*1000, "alias-a", false, 100, 20, &latency100)
	first.ResolvedModel = "resolved-a"
	first.ServiceTier = "priority"
	second := readerEvent("reader-second", fromMS+hourMS+5*60*1000, "alias-a", true, 300_000, 30, &latency300)
	second.ResolvedModel = "resolved-a"
	second.ServiceTier = "priority"
	third := readerEvent("reader-third", toMS-5*60*1000, "model-b", false, 300, 40, nil)
	if _, err := db.InsertEvents(ctx, []usage.Event{first, second, third}); err != nil {
		t.Fatalf("insert events: %v", err)
	}

	rawAggregate, err := db.AggregateBetween(ctx, fromMS, toMS)
	if err != nil {
		t.Fatalf("raw aggregate: %v", err)
	}
	rawModels, err := db.ModelStatsBetween(ctx, fromMS, toMS)
	if err != nil {
		t.Fatalf("raw models: %v", err)
	}
	rawDashboardTimeline, err := db.HourlyTimelineBetween(ctx, fromMS, toMS)
	if err != nil {
		t.Fatalf("raw dashboard timeline: %v", err)
	}
	filter := store.AnalyticsFilter{FromMS: fromMS, ToMS: toMS, IncludeFailed: true}
	rawAnalyticsTimeline, err := db.TimelineWithFilter(ctx, filter, "day", time.UTC)
	if err != nil {
		t.Fatalf("raw analytics timeline: %v", err)
	}

	catchUpReaderRollup(t, ctx, db)
	reader := New(db, true)
	snapshot, ok := reader.Load(ctx, fromMS, toMS)
	if !ok {
		t.Fatal("reader did not use rollup")
	}
	if !reflect.DeepEqual(snapshot.Aggregate, rawAggregate) {
		t.Fatalf("aggregate mismatch\nrollup=%#v\nraw=%#v", snapshot.Aggregate, rawAggregate)
	}
	if snapshot.Aggregate.LongInputTokens != second.InputTokens {
		t.Fatalf("long input tokens = %d, want %d", snapshot.Aggregate.LongInputTokens, second.InputTokens)
	}
	if !reflect.DeepEqual(snapshot.ModelStats, rawModels) {
		t.Fatalf("model stats mismatch\nrollup=%#v\nraw=%#v", snapshot.ModelStats, rawModels)
	}
	dashboardTimeline, ok := reader.DashboardTimeline(ctx, snapshot, fromMS, toMS)
	if !ok || !reflect.DeepEqual(dashboardTimeline, rawDashboardTimeline) {
		t.Fatalf("dashboard timeline mismatch\nrollup=%#v\nraw=%#v", dashboardTimeline, rawDashboardTimeline)
	}
	analyticsTimeline, ok := reader.AnalyticsTimeline(ctx, snapshot, "day", time.UTC)
	if !ok || !reflect.DeepEqual(analyticsTimeline, rawAnalyticsTimeline) {
		t.Fatalf("analytics timeline mismatch\nrollup=%#v\nraw=%#v", analyticsTimeline, rawAnalyticsTimeline)
	}

	projected, ok := reader.LoadAnalytics(ctx, fromMS, toMS, "day", time.UTC, true)
	if !ok {
		t.Fatal("analytics reader did not use daily projection")
	}
	if !reflect.DeepEqual(projected.Aggregate, rawAggregate) || !reflect.DeepEqual(projected.ModelStats, rawModels) {
		t.Fatalf("projected core mismatch\nrollup=%#v %#v\nraw=%#v %#v", projected.Aggregate, projected.ModelStats, rawAggregate, rawModels)
	}
	projectedTimeline, ok := reader.AnalyticsTimeline(ctx, projected, "day", time.UTC)
	if !ok || !reflect.DeepEqual(projectedTimeline, rawAnalyticsTimeline) {
		t.Fatalf("projected timeline mismatch\nrollup=%#v\nraw=%#v", projectedTimeline, rawAnalyticsTimeline)
	}
	if _, ok := reader.DashboardTimeline(ctx, projected, fromMS, toMS); ok {
		t.Fatal("daily analytics projection unexpectedly exposed dashboard timeline")
	}

	modelOnly, ok := reader.LoadAnalytics(ctx, fromMS, toMS, "day", time.UTC, false)
	if !ok || !reflect.DeepEqual(modelOnly.Aggregate, rawAggregate) || !reflect.DeepEqual(modelOnly.ModelStats, rawModels) {
		t.Fatalf("model-only projection mismatch\nrollup=%#v %#v\nraw=%#v %#v", modelOnly.Aggregate, modelOnly.ModelStats, rawAggregate, rawModels)
	}
	if _, ok := reader.AnalyticsTimeline(ctx, modelOnly, "day", time.UTC); ok {
		t.Fatal("model-only projection unexpectedly exposed analytics timeline")
	}
}

func TestReaderAnalyticsTimelineFallsBackForHalfHourBuckets(t *testing.T) {
	db := newReaderTestStore(t)
	ctx := context.Background()
	fromMS := int64(1_800_000_000_000)
	toMS := fromMS + 3*hourMS
	if _, err := db.InsertEvents(ctx, []usage.Event{
		readerEvent("half-hour-zone", fromMS+10*60*1000, "model-a", false, 1, 2, nil),
	}); err != nil {
		t.Fatalf("insert events: %v", err)
	}
	catchUpReaderRollup(t, ctx, db)
	snapshot, ok := New(db, true).Load(ctx, fromMS, toMS)
	if !ok {
		t.Fatal("reader did not load rollup")
	}
	location, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	reader := New(db, true)
	if reader.CanRepresentAnalyticsTimeline(fromMS, toMS, "hour", location) {
		t.Fatal("half-hour timeline unexpectedly reported as representable")
	}
	if _, ok := reader.AnalyticsTimeline(ctx, snapshot, "hour", location); ok {
		t.Fatal("half-hour timeline unexpectedly used UTC hourly rollup")
	}
}

func TestReaderPreservesEmptyLiteralDashAndWhitespaceModels(t *testing.T) {
	db := newReaderTestStore(t)
	ctx := context.Background()
	fromMS := int64(1_800_000_000_000)
	toMS := fromMS + 2*hourMS
	empty := readerEvent("empty-model", fromMS+1_000, "", false, 1, 2, nil)
	dash := readerEvent("dash-model", fromMS+2_000, "-", false, 2, 3, nil)
	padded := readerEvent("padded-model", fromMS+3_000, " model ", false, 3, 4, nil)
	padded.ResolvedModel = " resolved "
	padded.ServiceTier = " priority "
	if _, err := db.InsertEvents(ctx, []usage.Event{empty, dash, padded}); err != nil {
		t.Fatalf("insert events: %v", err)
	}
	catchUpReaderRollup(t, ctx, db)

	rawAggregate, err := db.AggregateBetween(ctx, fromMS, toMS)
	if err != nil {
		t.Fatalf("raw aggregate: %v", err)
	}
	rawModels, err := db.ModelStatsBetween(ctx, fromMS, toMS)
	if err != nil {
		t.Fatalf("raw models: %v", err)
	}
	filter := store.AnalyticsFilter{FromMS: fromMS, ToMS: toMS, IncludeFailed: true}
	rawTimeline, err := db.TimelineWithFilter(ctx, filter, "day", time.UTC)
	if err != nil {
		t.Fatalf("raw timeline: %v", err)
	}
	snapshot, ok := New(db, true).LoadAnalytics(ctx, fromMS, toMS, "day", time.UTC, false)
	if !ok {
		t.Fatal("dimension-preserving rollup was unavailable")
	}
	if !reflect.DeepEqual(snapshot.Aggregate, rawAggregate) || !reflect.DeepEqual(snapshot.ModelStats, rawModels) {
		t.Fatalf("dimension-preserving rollup mismatch\nrollup=%#v %#v\nraw=%#v %#v", snapshot.Aggregate, snapshot.ModelStats, rawAggregate, rawModels)
	}
	timelineSnapshot, ok := New(db, true).LoadAnalytics(ctx, fromMS, toMS, "day", time.UTC, true)
	if !ok {
		t.Fatal("dimension-preserving timeline rollup was unavailable")
	}
	rolledTimeline, ok := New(db, true).AnalyticsTimeline(ctx, timelineSnapshot, "day", time.UTC)
	sortTimelinePoints(rawTimeline)
	sortTimelinePoints(rolledTimeline)
	if !ok || !reflect.DeepEqual(rolledTimeline, rawTimeline) {
		t.Fatalf("dimension-preserving timeline mismatch\nrollup=%#v\nraw=%#v", rolledTimeline, rawTimeline)
	}
}

func sortTimelinePoints(points []store.TimelinePoint) {
	sort.Slice(points, func(i, j int) bool {
		if points[i].BucketMS != points[j].BucketMS {
			return points[i].BucketMS < points[j].BucketMS
		}
		if points[i].Model != points[j].Model {
			return points[i].Model < points[j].Model
		}
		if points[i].BillingModel != points[j].BillingModel {
			return points[i].BillingModel < points[j].BillingModel
		}
		return points[i].ServiceTier < points[j].ServiceTier
	})
}

func TestReaderFallsBackWhenDisabledOrPending(t *testing.T) {
	db := newReaderTestStore(t)
	ctx := context.Background()
	fromMS := int64(1_800_000_000_000)
	toMS := fromMS + 2*hourMS
	if _, err := db.InsertEvents(ctx, []usage.Event{
		readerEvent("pending", fromMS+1_000, "model-a", false, 1, 2, nil),
	}); err != nil {
		t.Fatalf("insert events: %v", err)
	}
	if _, ok := New(db, false).Load(ctx, fromMS, toMS); ok {
		t.Fatal("disabled reader used rollup")
	}
	if _, ok := New(db, true).Load(ctx, fromMS, toMS); ok {
		t.Fatal("pending checkpoint used rollup")
	}
}

func TestReaderFallbackLogIsRateLimited(t *testing.T) {
	reader := New(newReaderTestStore(t), true)
	reader.logFallback("first")
	first := reader.lastFallbackLogMS.Load()
	if first <= 0 {
		t.Fatalf("first log timestamp = %d", first)
	}
	reader.logFallback("second")
	if got := reader.lastFallbackLogMS.Load(); got != first {
		t.Fatalf("fallback log was not rate limited: first=%d got=%d", first, got)
	}
}

func catchUpReaderRollup(t *testing.T, ctx context.Context, db *store.Store) {
	t.Helper()
	for {
		result, err := db.CatchUpDashboardHourlyRollups(ctx, 100, time.Now().UnixMilli())
		if err != nil {
			t.Fatalf("catch up rollup: %v", err)
		}
		if !result.Pending {
			return
		}
	}
}

func newReaderTestStore(t *testing.T) *store.Store {
	t.Helper()
	db, err := store.Open(t.TempDir() + "/usage.sqlite")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func readerEvent(hash string, timestampMS int64, model string, failed bool, inputTokens, outputTokens int64, latencyMS *int64) usage.Event {
	return usage.Event{
		EventHash:    hash,
		TimestampMS:  timestampMS,
		Timestamp:    time.UnixMilli(timestampMS).UTC().Format(time.RFC3339Nano),
		Model:        model,
		Endpoint:     "POST /v1/chat/completions",
		Method:       "POST",
		Path:         "/v1/chat/completions",
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		TotalTokens:  inputTokens + outputTokens,
		LatencyMS:    latencyMS,
		Failed:       failed,
	}
}
