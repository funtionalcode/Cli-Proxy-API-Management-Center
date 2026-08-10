package worker

import (
	"context"
	"log"
	"sync/atomic"
	"time"

	collectorpkg "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/collector"
	monitoringrepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/usagemonitoring"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

const (
	defaultUsagePricingBatchLimit    = 1000
	defaultUsagePricingMaxBatches    = 10
	defaultUsagePricingCheckInterval = 30 * time.Second
)

type UsagePricingRollupWorker struct {
	store             *store.Store
	wake              chan struct{}
	running           int32
	batchLimit        int
	maxBatches        int
	checkInterval     time.Duration
	continuationDelay time.Duration
	nextTask          int
}

const (
	usageDerivedPricingTask = iota
	usageDerivedMonitoringProjectionTask
	usageDerivedMonitoringMetadataTask
	usageDerivedMonitoringStatsTask
	usageDerivedTaskCount
)

func NewUsagePricingRollupWorker(store *store.Store) *UsagePricingRollupWorker {
	return &UsagePricingRollupWorker{
		store:             store,
		wake:              make(chan struct{}, 1),
		batchLimit:        defaultUsagePricingBatchLimit,
		maxBatches:        defaultUsagePricingMaxBatches,
		checkInterval:     defaultUsagePricingCheckInterval,
		continuationDelay: defaultRollupContinuationDelay,
	}
}

func (w *UsagePricingRollupWorker) Start(ctx context.Context) {
	if w == nil || w.store == nil {
		return
	}
	go w.loop(ctx)
	w.Wake()
}

func (w *UsagePricingRollupWorker) HandleUsageEvents(ctx context.Context, _ collectorpkg.RuntimeConfig, events []usage.Event) {
	if w == nil || len(events) == 0 || ctx.Err() != nil {
		return
	}
	w.Wake()
}

func (w *UsagePricingRollupWorker) Wake() {
	if w == nil {
		return
	}
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

func (w *UsagePricingRollupWorker) loop(ctx context.Context) {
	runRollupLoop(ctx, w.wake, w.checkInterval, w.continuationDelay, w.catchUp)
}

func (w *UsagePricingRollupWorker) catchUp(ctx context.Context) bool {
	if !atomic.CompareAndSwapInt32(&w.running, 0, 1) {
		return false
	}
	defer atomic.StoreInt32(&w.running, 0)

	pendingByTask := [usageDerivedTaskCount]bool{}
	idleByTask := [usageDerivedTaskCount]bool{}
	for batch := 0; batch < w.maxBatches; batch++ {
		if ctx.Err() != nil {
			return false
		}
		if allUsageDerivedTasksIdle(idleByTask) {
			break
		}
		task := w.nextRunnableTask(idleByTask)
		w.nextTask = (task + 1) % usageDerivedTaskCount
		nowMS := time.Now().UnixMilli()
		result, err := w.catchUpTask(ctx, task, nowMS)
		if err != nil {
			log.Printf("[usage-derived] %s catch-up failed: %v", usageDerivedTaskName(task), err)
			if recordErr := w.recordTaskFailure(ctx, task, err, nowMS); recordErr != nil && ctx.Err() == nil {
				log.Printf("[usage-derived] record %s catch-up failure: %v", usageDerivedTaskName(task), recordErr)
			}
			idleByTask[task] = true
			pendingByTask[task] = false
			continue
		}
		pendingByTask[task] = result.Pending && result.Processed > 0
		if result.Processed == 0 || !result.Pending {
			idleByTask[task] = true
		}
	}
	for _, pending := range pendingByTask {
		if pending {
			return true
		}
	}
	return false
}

type usageDerivedCatchUpResult struct {
	Processed int
	Pending   bool
}

func (w *UsagePricingRollupWorker) nextRunnableTask(idle [usageDerivedTaskCount]bool) int {
	for offset := 0; offset < usageDerivedTaskCount; offset++ {
		task := (w.nextTask + offset) % usageDerivedTaskCount
		if !idle[task] {
			return task
		}
	}
	return w.nextTask % usageDerivedTaskCount
}

func allUsageDerivedTasksIdle(idle [usageDerivedTaskCount]bool) bool {
	for _, taskIdle := range idle {
		if !taskIdle {
			return false
		}
	}
	return true
}

func (w *UsagePricingRollupWorker) catchUpTask(ctx context.Context, task int, nowMS int64) (usageDerivedCatchUpResult, error) {
	switch task {
	case usageDerivedMonitoringProjectionTask:
		result, err := w.store.CatchUpUsageMonitoringProjection(ctx, w.batchLimit, nowMS)
		return usageDerivedCatchUpResult{Processed: result.Processed, Pending: result.Pending}, err
	case usageDerivedMonitoringMetadataTask:
		result, err := w.store.CatchUpUsageMonitoringMetadata(ctx, w.batchLimit, nowMS)
		return usageDerivedCatchUpResult{Processed: result.Processed, Pending: result.Pending}, err
	case usageDerivedMonitoringStatsTask:
		result, err := w.store.CatchUpUsageMonitoringStats(ctx, w.batchLimit, nowMS)
		return usageDerivedCatchUpResult{Processed: result.Processed, Pending: result.Pending}, err
	default:
		result, err := w.store.CatchUpUsagePricing(ctx, w.batchLimit, nowMS)
		return usageDerivedCatchUpResult{Processed: result.Processed, Pending: result.Pending}, err
	}
}

func (w *UsagePricingRollupWorker) recordTaskFailure(ctx context.Context, task int, rollupErr error, nowMS int64) error {
	switch task {
	case usageDerivedMonitoringProjectionTask:
		return w.store.RecordUsageMonitoringFailure(ctx, monitoringrepo.ProjectionRollupName, rollupErr, nowMS)
	case usageDerivedMonitoringMetadataTask:
		return w.store.RecordUsageMonitoringFailure(ctx, monitoringrepo.MetadataRollupName, rollupErr, nowMS)
	case usageDerivedMonitoringStatsTask:
		return w.store.RecordUsageMonitoringFailure(ctx, monitoringrepo.StatsRollupName, rollupErr, nowMS)
	default:
		return w.store.RecordUsagePricingFailure(ctx, rollupErr, nowMS)
	}
}

func usageDerivedTaskName(task int) string {
	switch task {
	case usageDerivedMonitoringProjectionTask:
		return "monitoring projection"
	case usageDerivedMonitoringMetadataTask:
		return "monitoring metadata"
	case usageDerivedMonitoringStatsTask:
		return "monitoring stats"
	default:
		return "pricing"
	}
}
