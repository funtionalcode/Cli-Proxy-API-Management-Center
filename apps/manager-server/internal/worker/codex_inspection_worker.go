package worker

import (
	"context"
	"log"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	codexinspectionservice "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/codexinspection"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

type CodexInspectionWorker struct {
	store   *store.Store
	service *codexinspectionservice.Service
}

func NewCodexInspectionWorker(store *store.Store, service *codexinspectionservice.Service) *CodexInspectionWorker {
	return &CodexInspectionWorker{store: store, service: service}
}

func (w *CodexInspectionWorker) Start(ctx context.Context) {
	if w == nil || w.service == nil {
		return
	}
	go w.run(ctx)
}

func (w *CodexInspectionWorker) run(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	w.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

func (w *CodexInspectionWorker) tick(ctx context.Context) {
	cfg, configured, err := w.service.ResolveConfig(ctx)
	if err != nil {
		log.Printf("resolve codex inspection config: %v", err)
		return
	}
	if !configured || cfg.Enabled == nil || !*cfg.Enabled {
		return
	}
	now := time.Now()
	triggerKey := model.CodexInspectionTriggerKey(now, cfg)
	if triggerKey == "" || !model.CodexInspectionScheduleDue(now, w.lastScheduledRunTime(ctx), cfg) {
		return
	}
	if _, ok, err := w.store.GetLatestCodexInspectionRunByTrigger(ctx, model.CodexInspectionTriggerScheduled, triggerKey); err != nil {
		log.Printf("load codex inspection trigger: %v", err)
		return
	} else if ok {
		return
	}
	go func() {
		if _, err := w.service.Run(ctx, codexinspectionservice.RunRequest{
			TriggerType: model.CodexInspectionTriggerScheduled,
			TriggerKey:  triggerKey,
		}); err != nil && err != codexinspectionservice.ErrRunAlreadyActive {
			log.Printf("run scheduled codex inspection: %v", err)
		}
	}()
}

func (w *CodexInspectionWorker) lastScheduledRunTime(ctx context.Context) time.Time {
	runs, err := w.store.ListCodexInspectionRuns(ctx, 20)
	if err != nil {
		return time.Time{}
	}
	for _, run := range runs {
		if run.TriggerType != model.CodexInspectionTriggerScheduled || run.StartedAtMS <= 0 {
			continue
		}
		return time.UnixMilli(run.StartedAtMS)
	}
	return time.Time{}
}
