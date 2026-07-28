package codexinspection

import (
	"bytes"
	"context"
	cryptorand "crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	codexinspectionrepo "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/repository/codexinspection"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpa"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpaauthfiles"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/credentialpolicy"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/managerconfig"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

const (
	codexUsageURL             = "https://chatgpt.com/backend-api/wham/usage"
	codexFiveHourWindow       = 18_000
	codexWeekWindow           = 604_800
	codexMonthWindow          = 2_592_000
	codexMinMonthWindow       = 28 * 24 * 60 * 60
	codexMaxMonthWindow       = 31 * 24 * 60 * 60
	maxStoredBodyText         = 2048
	maxCPAAPICallResponseSize = 16 * 1024 * 1024
	criticalWriteTimeout      = 8 * time.Second
	processLogWriteTimeout    = 750 * time.Millisecond
	resultWriteTimeout        = 2 * time.Second
	resultPersistenceTimeout  = 8 * time.Second
	cancelledPersistTimeout   = 2 * time.Second
	processLogQueueWait       = 10 * time.Millisecond
	minimumInspectionLease    = time.Millisecond
	userCancelRequestReason   = "用户请求取消巡检"
	userCancelledReason       = "用户主动取消巡检"
)

var (
	ErrRunAlreadyActive           = errors.New("codex inspection is already running")
	ErrRunNotCancellable          = errors.New("codex inspection run cannot be cancelled")
	ErrServiceStopping            = errors.New("codex inspection service is stopping")
	ErrRunNotOwned                = errors.New("codex inspection run is owned by another instance")
	ErrTriggerAlreadyExists       = errors.New("codex inspection trigger already handled")
	ErrScheduledRunDisabled       = errors.New("scheduled codex inspection is disabled")
	ErrNotConfigured              = errors.New("usage service is not configured")
	ErrRunNotFound                = errors.New("codex inspection run not found")
	ErrRunNotCompleted            = errors.New("codex inspection run is not completed")
	ErrActionIDsRequired          = errors.New("codex inspection action result ids are required")
	ErrNoActionableResults        = errors.New("codex inspection has no actionable results")
	ErrInvalidActionOverride      = errors.New("codex inspection action override is invalid")
	errCPAAPICallResponseTooLarge = errors.New("CPA api-call response too large")
)

type Service struct {
	store                *store.Store
	managerConfigService *managerconfig.Service
	client               *http.Client

	mu                sync.Mutex
	cancelMu          sync.Mutex
	active            *localRun
	starting          bool
	startDone         chan struct{}
	startCancel       context.CancelFunc
	auxiliaryRunning  bool
	auxiliaryDone     chan struct{}
	auxiliaryCancel   context.CancelFunc
	lifecycleOps      int
	lifecycleDone     chan struct{}
	stopping          bool
	ownerID           string
	leaseDuration     time.Duration
	heartbeatInterval time.Duration
	logMu             sync.Mutex
	logGate           chan struct{}
}

type ServiceOptions struct {
	OwnerID           string
	LeaseDuration     time.Duration
	HeartbeatInterval time.Duration
}

var inspectionOwnerSequence atomic.Uint64

type terminationReason string

const (
	terminationNone     terminationReason = ""
	terminationUser     terminationReason = "user_cancel"
	terminationShutdown terminationReason = "service_shutdown"
	terminationLease    terminationReason = "lease_lost"
)

type localRun struct {
	runID             int64
	cancel            context.CancelFunc
	done              chan struct{}
	leaseHeartbeatAt  time.Time
	terminationReason terminationReason
	finalizing        bool
	result            RunDetail
	err               error
}

type RunRequest struct {
	TriggerType string
	TriggerKey  string
}

type RunDetail struct {
	Run     model.CodexInspectionRun      `json:"run"`
	Results []model.CodexInspectionResult `json:"results"`
	Logs    []model.CodexInspectionLog    `json:"logs"`
}

type ExecuteActionsRequest struct {
	ResultIDs       []int64                `json:"resultIds"`
	ActionOverrides []ManualActionOverride `json:"actionOverrides,omitempty"`
}

type ManualActionOverride struct {
	ResultID int64  `json:"resultId"`
	Action   string `json:"action"`
}

type ActionOutcome struct {
	ResultID        int64  `json:"resultId,omitempty"`
	AccountKey      string `json:"accountKey,omitempty"`
	FileName        string `json:"fileName"`
	DisplayAccount  string `json:"displayAccount"`
	Action          string `json:"action"`
	Status          string `json:"status"`
	Success         bool   `json:"success"`
	Error           string `json:"error,omitempty"`
	CurrentDisabled *bool  `json:"-"`
}

type ExecuteActionsResult struct {
	Outcomes []ActionOutcome `json:"outcomes"`
	Detail   RunDetail       `json:"detail"`
}

type authFile map[string]any

type account struct {
	Key              string
	FileName         string
	DisplayAccount   string
	AuthIndex        string
	AccountID        string
	Provider         string
	Disabled         bool
	AutoRecoverOwned bool
	Status           string
	State            string
	File             authFile
}

type apiCallResponse struct {
	StatusCode    int
	HasStatusCode bool
	BodyText      string
	Body          any
}

type inspectionDecision struct {
	Action       string
	ActionReason string
	UsedPercent  *float64
	IsQuota      bool
}

type fileActionGroup struct {
	FileName string
	Items    []model.CodexInspectionResult
	Action   string
	Mixed    bool
}

const (
	fileActionDuplicateReason = "CPA 认证文件动作按文件执行，该文件已由另一条结果处理"
	fileActionMixedReason     = "同一认证文件下存在多个不同建议动作，文件级处理已阻止，请到认证文件管理中手动处理"
)

type codexRateLimit struct {
	Allowed         *bool
	LimitReached    bool
	PrimaryWindow   *codexWindow
	SecondaryWindow *codexWindow
}

type codexWindow struct {
	UsedPercent        *float64
	LimitWindowSeconds *float64
	ResetAfterSeconds  *float64
	ResetAt            *float64
}

type codexClassifiedWindows struct {
	FiveHour    *codexWindow
	Weekly      *codexWindow
	Monthly     *codexWindow
	GenericLong *codexWindow
}

type codexWindowMeta struct {
	ID       string
	LabelKey string
}

func (w codexClassifiedWindows) longWindow() *codexWindow {
	if w.Weekly != nil {
		return w.Weekly
	}
	if w.Monthly != nil {
		return w.Monthly
	}
	return w.GenericLong
}

func (w codexClassifiedWindows) longWindowLabel(window *codexWindow) string {
	switch window {
	case w.Weekly:
		return "周额度"
	case w.Monthly:
		return "月额度"
	case w.GenericLong:
		return "长期额度"
	default:
		return "长期额度"
	}
}

func New(st *store.Store, managerConfigService *managerconfig.Service, clients ...*http.Client) *Service {
	return NewWithOptions(st, managerConfigService, ServiceOptions{}, clients...)
}

func NewWithOptions(st *store.Store, managerConfigService *managerconfig.Service, options ServiceOptions, clients ...*http.Client) *Service {
	client := &http.Client{Timeout: 30 * time.Second}
	if len(clients) > 0 && clients[0] != nil {
		client = clients[0]
	}
	ownerID := strings.TrimSpace(options.OwnerID)
	if ownerID == "" {
		ownerID = inspectionOwnerID()
	}
	leaseDuration := options.LeaseDuration
	if leaseDuration <= 0 {
		leaseDuration = 30 * time.Second
	}
	if leaseDuration < minimumInspectionLease {
		leaseDuration = minimumInspectionLease
	}
	heartbeatInterval := options.HeartbeatInterval
	if heartbeatInterval <= 0 || heartbeatInterval >= leaseDuration {
		heartbeatInterval = leaseDuration / 3
		if heartbeatInterval <= 0 {
			heartbeatInterval = time.Nanosecond
		}
		if heartbeatInterval >= leaseDuration {
			heartbeatInterval = leaseDuration - time.Nanosecond
		}
	}
	if heartbeatInterval <= 0 {
		heartbeatInterval = time.Nanosecond
	}
	return &Service{
		store:                st,
		managerConfigService: managerConfigService,
		client:               client,
		ownerID:              ownerID,
		leaseDuration:        leaseDuration,
		heartbeatInterval:    heartbeatInterval,
		logGate:              make(chan struct{}, 1),
	}
}

func inspectionOwnerID() string {
	var randomBytes [12]byte
	randomSuffix := "unavailable"
	if _, err := cryptorand.Read(randomBytes[:]); err != nil {
		log.Printf("generate codex inspection lease owner random suffix: %v", err)
	} else {
		randomSuffix = hex.EncodeToString(randomBytes[:])
	}
	host, _ := os.Hostname()
	return fmt.Sprintf(
		"%s:%d:%d:%d:%s",
		strings.TrimSpace(host),
		os.Getpid(),
		time.Now().UnixNano(),
		inspectionOwnerSequence.Add(1),
		randomSuffix,
	)
}

func (s *Service) beginStart(startCancel context.CancelFunc) (chan struct{}, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopping {
		return nil, ErrServiceStopping
	}
	if s.starting || s.active != nil || s.auxiliaryRunning {
		return nil, ErrRunAlreadyActive
	}
	done := make(chan struct{})
	s.starting = true
	s.startDone = done
	s.startCancel = startCancel
	return done, nil
}

func (s *Service) finishStart(done chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.startDone != done {
		return
	}
	s.starting = false
	s.startDone = nil
	s.startCancel = nil
	close(done)
}

func (s *Service) finalizeUnstartedRun(run model.CodexInspectionRun, status, reason string) {
	run.Status = status
	run.Error = reason
	run.FinishedAtMS = time.Now().UnixMilli()
	finalLog := &model.CodexInspectionLog{
		RunID:   run.ID,
		Level:   "warning",
		Message: reason,
		Detail: map[string]any{
			"status": status,
			"reason": "start_aborted",
		},
	}
	finalizeCtx, cancelFinalize := context.WithTimeout(context.Background(), criticalWriteTimeout)
	defer cancelFinalize()
	if err := s.finalizeInspectionRunWithContext(finalizeCtx, run, finalLog); err != nil {
		if fallbackErr := s.forceFinalizeInspectionRunWithContext(finalizeCtx, run, finalLog); fallbackErr != nil {
			log.Printf("finalize unstarted codex inspection run %d: %v (fallback: %v)", run.ID, err, fallbackErr)
		} else {
			log.Printf("finalize unstarted codex inspection run %d via fenced recovery", run.ID)
		}
	}
}

func (s *Service) Run(ctx context.Context, req RunRequest) (RunDetail, error) {
	task, initial, err := s.startRun(ctx, req, false)
	if err != nil {
		return RunDetail{}, err
	}
	if task == nil {
		return initial, nil
	}
	<-task.done
	return task.result, task.err
}

// Start creates a run and returns immediately. The execution context is owned
// by the service, so an HTTP client disconnect cannot silently abandon a run.
func (s *Service) Start(ctx context.Context, req RunRequest) (RunDetail, error) {
	_, initial, err := s.startRun(ctx, req, true)
	return initial, err
}

func (s *Service) startRun(ctx context.Context, req RunRequest, detach bool) (*localRun, RunDetail, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	acquireCtx, cancelAcquire := context.WithCancel(ctx)
	startDone, err := s.beginStart(cancelAcquire)
	if err != nil {
		cancelAcquire()
		return nil, RunDetail{}, err
	}
	defer s.finishStart(startDone)
	defer cancelAcquire()

	triggerType := strings.TrimSpace(req.TriggerType)
	if triggerType == "" {
		triggerType = model.CodexInspectionTriggerManual
	}
	settings, setup, err := s.resolveRuntime(acquireCtx)
	if err != nil {
		return nil, RunDetail{}, err
	}
	if triggerType == model.CodexInspectionTriggerScheduled && (settings.Enabled == nil || !*settings.Enabled) {
		return nil, RunDetail{}, ErrScheduledRunDisabled
	}
	triggerKey := strings.TrimSpace(req.TriggerKey)
	acquired, err := s.store.AcquireCodexInspectionRun(acquireCtx, model.CodexInspectionRun{
		TriggerType:  triggerType,
		TriggerKey:   triggerKey,
		Status:       model.CodexInspectionStatusRunning,
		Settings:     settings,
		SettingsJSON: model.MarshalCodexInspectionSettings(settings),
	}, s.ownerID, s.leaseDuration)
	if err != nil {
		if errors.Is(err, codexinspectionrepo.ErrLeaseAlreadyActive) {
			return nil, RunDetail{}, ErrRunAlreadyActive
		}
		if errors.Is(err, codexinspectionrepo.ErrTriggerAlreadyExists) {
			return nil, RunDetail{}, ErrTriggerAlreadyExists
		}
		return nil, RunDetail{}, err
	}
	run := acquired.Run
	executionCtx := ctx
	if detach {
		executionCtx = context.WithoutCancel(ctx)
	}
	executionCtx, cancel := context.WithCancel(executionCtx)
	leaseHeartbeatAt := time.Now()
	if run.UpdatedAtMS > 0 {
		leaseHeartbeatAt = time.UnixMilli(run.UpdatedAtMS)
	}
	task := &localRun{
		runID:            run.ID,
		cancel:           cancel,
		done:             make(chan struct{}),
		leaseHeartbeatAt: leaseHeartbeatAt,
	}
	s.mu.Lock()
	if s.stopping {
		s.mu.Unlock()
		cancel()
		s.finalizeUnstartedRun(run, model.CodexInspectionStatusInterrupted, "服务关闭导致巡检未能启动")
		return nil, RunDetail{}, ErrServiceStopping
	}
	if s.active != nil || s.auxiliaryRunning {
		s.mu.Unlock()
		cancel()
		s.finalizeUnstartedRun(run, model.CodexInspectionStatusInterrupted, "本地巡检状态冲突，任务未能启动")
		return nil, RunDetail{}, ErrRunAlreadyActive
	}
	s.active = task
	s.mu.Unlock()
	go s.runTask(task, executionCtx, req, run, settings, setup)
	initial := RunDetail{
		Run:     run,
		Results: []model.CodexInspectionResult{},
		Logs:    []model.CodexInspectionLog{},
	}
	initial.Run.Active = true
	initial.Run.Cancellable = true
	return task, initial, nil
}

func (s *Service) executeRun(ctx context.Context, req RunRequest, run model.CodexInspectionRun, settings model.ManagerCodexInspectionConfig, setup store.Setup) (RunDetail, error) {
	persistCtx := context.WithoutCancel(ctx)
	triggerType := run.TriggerType
	triggerKey := run.TriggerKey

	logger := runLogger{service: s, runID: run.ID}
	logger.info(ctx, "凭证健康巡检开始", map[string]any{
		"triggerType": triggerType,
		"triggerKey":  triggerKey,
		"targetTypes": settings.TargetProviders(),
	})

	files, err := s.fetchAuthFiles(ctx, setup)
	if err != nil {
		logger.error(persistCtx, "加载认证文件列表失败", map[string]any{"error": err.Error()})
		if ctx.Err() != nil {
			run.Error = err.Error()
			return RunDetail{Run: run}, err
		}
		return s.failRun(persistCtx, run, err)
	}

	allAccounts := make([]account, 0, len(files))
	for _, file := range files {
		allAccounts = append(allAccounts, toAccount(file))
	}
	s.applyDisableOwnership(ctx, allAccounts, logger)

	accounts := make([]account, 0, len(allAccounts))
	for _, next := range allAccounts {
		if settings.HasTargetProvider(next.Provider) {
			accounts = append(accounts, next)
		}
	}
	probeSetCount := len(accounts)
	sampled := pickSamplePerProvider(accounts, settings.SampleSize)

	run.TotalFiles = len(files)
	run.ProbeSetCount = probeSetCount
	run.SampledCount = len(sampled)
	run.DisabledCount = countAccounts(sampled, true)
	run.EnabledCount = len(sampled) - run.DisabledCount
	progressCtx, cancelProgress := context.WithTimeout(persistCtx, criticalWriteTimeout)
	progressErr := s.store.UpdateCodexInspectionRunProgress(progressCtx, run, s.ownerID)
	cancelProgress()
	if progressErr != nil {
		log.Printf("update codex inspection progress run %d: %v", run.ID, progressErr)
		if errors.Is(progressErr, codexinspectionrepo.ErrLeaseLost) {
			return RunDetail{Run: run}, progressErr
		}
	}

	logger.info(ctx, "凭证健康巡检集合已准备", map[string]any{
		"totalFiles":    len(files),
		"probeSetCount": probeSetCount,
		"sampledCount":  len(sampled),
		"targetTypes":   settings.TargetProviders(),
	})

	results := s.inspectAccounts(ctx, setup, settings, sampled, logger)
	if err := ctx.Err(); err != nil {
		// Persist the partial probe set once, with a bounded budget, before the
		// lifecycle transition below. Avoid a second full pass here: a large
		// cancelled run must still reach cancelled/interrupted promptly.
		resultWriteFailures := s.persistInspectionResults(ctx, run.ID, results, logger)
		run = summarizeRun(run, results)
		// Keep the persisted row active until runTask performs the lifecycle
		// transition and lease release atomically. Synchronous callers still
		// become failed; explicit user/shutdown cancellation gets its own state.
		run.Status = model.CodexInspectionStatusRunning
		run.Error = err.Error()
		if resultWriteFailures > 0 {
			run.Error += fmt.Sprintf("；%d 个巡检结果写入失败，详见巡检日志", resultWriteFailures)
		}
		logger.warning(persistCtx, "凭证健康巡检已取消", map[string]any{"error": run.Error})
		detailCtx, cancelDetail := boundedCancelledInspectionContext(persistCtx)
		detail, detailErr := s.getRunWithResultFallback(detailCtx, run.ID, results, resultWriteFailures > 0)
		cancelDetail()
		if detailErr != nil {
			return RunDetail{}, detailErr
		}
		detail.Run = run
		return detail, nil
	}
	initialResultWriteFailures := s.persistInspectionResults(ctx, run.ID, results, logger)
	if initialResultWriteFailures > 0 {
		log.Printf("persist initial codex inspection results run %d: %d writes failed", run.ID, initialResultWriteFailures)
	}

	results = resolveAutoActionResults(settings.AutoActionMode, results)
	actionOutcomes := s.executeAutoActions(ctx, setup, settings, results, logger)
	actionSummary := summarizeActionOutcomes(actionOutcomes)
	results = applyActionOutcomes(results, actionOutcomes)
	resultWriteFailures := 0
	hasAutoActionMode := model.NormalizeCodexInspectionAutoActionMode(settings.AutoActionMode, model.CodexInspectionAutoActionNone) != model.CodexInspectionAutoActionNone || settings.AutoRecoverEnabled
	if hasAutoActionMode || initialResultWriteFailures > 0 {
		resultWriteFailures = s.persistInspectionResults(ctx, run.ID, results, logger)
	}
	run = summarizeRun(run, results)
	if err := ctx.Err(); err != nil {
		run.Status = model.CodexInspectionStatusRunning
		runErrors := []string{err.Error()}
		if resultWriteFailures > 0 {
			runErrors = append(runErrors, fmt.Sprintf("%d 个巡检结果写入失败，详见巡检日志", resultWriteFailures))
		}
		run.Error = strings.Join(runErrors, "；")
		logger.warning(persistCtx, "凭证健康巡检已取消", map[string]any{
			"error":                  run.Error,
			"actionSuccessCount":     actionSummary.Success,
			"actionFailedCount":      actionSummary.Failed,
			"actionSkippedCount":     actionSummary.Skipped,
			"actionNeedsReviewCount": actionSummary.NeedsReview,
			"resultWriteFailedCount": resultWriteFailures,
		})
		detailCtx, cancelDetail := boundedCancelledInspectionContext(persistCtx)
		detail, detailErr := s.getRunWithResultFallback(detailCtx, run.ID, results, resultWriteFailures > 0)
		cancelDetail()
		if detailErr != nil {
			return RunDetail{}, detailErr
		}
		detail.Run = run
		return detail, nil
	}
	failedActions := actionSummary.Failed
	runErrors := make([]string, 0, 2)
	if failedActions > 0 {
		runErrors = append(runErrors, fmt.Sprintf("%d 个自动处理动作执行失败，详见巡检日志", failedActions))
	}
	if resultWriteFailures > 0 {
		runErrors = append(runErrors, fmt.Sprintf("%d 个巡检结果写入失败，详见巡检日志", resultWriteFailures))
	}
	run.Error = strings.Join(runErrors, "；")
	run.Status = model.CodexInspectionStatusCompleted
	run.FinishedAtMS = time.Now().UnixMilli()
	completionDetail := map[string]any{
		"deleteCount":            run.DeleteCount,
		"disableCount":           run.DisableCount,
		"enableCount":            run.EnableCount,
		"reauthCount":            run.ReauthCount,
		"keepCount":              run.KeepCount,
		"actionSuccessCount":     actionSummary.Success,
		"actionFailedCount":      actionSummary.Failed,
		"actionSkippedCount":     actionSummary.Skipped,
		"actionNeedsReviewCount": actionSummary.NeedsReview,
		"actionErrors":           failedActionOutcomes(actionOutcomes),
		"resultWriteFailedCount": resultWriteFailures,
	}
	if failedActions > 0 || actionSummary.NeedsReview > 0 || resultWriteFailures > 0 {
		logger.warning(persistCtx, "凭证健康巡检完成", completionDetail)
	} else {
		logger.success(persistCtx, "凭证健康巡检完成", completionDetail)
	}
	detail, detailErr := s.getRunWithResultFallback(persistCtx, run.ID, results, resultWriteFailures > 0)
	if detailErr != nil {
		log.Printf("load completed codex inspection run %d before finalization: %v", run.ID, detailErr)
		return RunDetail{Run: run, Results: results}, nil
	}
	detail.Run = run
	return detail, nil
}

func (s *Service) runTask(task *localRun, ctx context.Context, req RunRequest, run model.CodexInspectionRun, settings model.ManagerCodexInspectionConfig, setup store.Setup) {
	heartbeatCtx, stopHeartbeat := context.WithCancel(context.WithoutCancel(ctx))
	heartbeatStopped := make(chan struct{})
	go s.heartbeatRun(task, heartbeatCtx, heartbeatStopped)
	var detail RunDetail
	var runErr error
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				runErr = fmt.Errorf("codex inspection panic: %v", recovered)
				detail = RunDetail{Run: run}
			}
		}()
		detail, runErr = s.executeRun(ctx, req, run, settings, setup)
	}()
	if errors.Is(runErr, codexinspectionrepo.ErrLeaseLost) {
		s.markLeaseLost(task)
	}
	executionCtxErr := ctx.Err()
	stopHeartbeat()
	<-heartbeatStopped
	// Release the execution context after all probe work has stopped. This is
	// especially important for detached HTTP/scheduler runs, whose parent is
	// intentionally kept alive past the request.
	task.cancel()

	s.mu.Lock()
	task.finalizing = true
	reason := task.terminationReason
	s.mu.Unlock()
	if reason == terminationNone && executionCtxErr != nil {
		// Synchronous callers retain the historical failed-on-context-cancel
		// behavior. Detached HTTP/scheduler runs are cancelled through an
		// explicit reason above and become cancelled/interrupted instead.
		runErr = nil
		reason = terminationNone
	}
	finalRun := run
	readTimeout := criticalWriteTimeout
	if executionCtxErr != nil || reason != terminationNone {
		// Cancellation/shutdown paths should spend only a short read budget before
		// entering the single bounded terminal-write budget below.
		readTimeout = cancelledPersistTimeout
	}
	readCtx, cancelRead := context.WithTimeout(context.Background(), readTimeout)
	persisted, persistedOK, persistedErr := s.store.GetCodexInspectionRun(readCtx, run.ID)
	cancelRead()
	persistedStatus := ""
	persistedError := ""
	if persistedErr == nil && persistedOK {
		finalRun = persisted
		persistedStatus = persisted.Status
		persistedError = persisted.Error
	} else if persistedErr != nil {
		log.Printf("load codex inspection run %d before finalization: %v", run.ID, persistedErr)
	}
	if detail.Run.ID > 0 && (!persistedOK || model.IsCodexInspectionRunActive(finalRun.Status)) {
		// Prefer the in-memory counters while the persisted row is still in an
		// active state. Once another instance has committed a terminal state,
		// keep that fenced result instead of allowing a stale worker snapshot
		// to regress it back to running/failed.
		finalRun = detail.Run
		// Preserve a cancellation transition committed by the API. The in-memory
		// executeRun snapshot can already be completed when the cancellation
		// transaction wins the race immediately before finalization.
		if persistedStatus == model.CodexInspectionStatusCancelling {
			finalRun.Status = persistedStatus
			finalRun.Error = persistedError
		}
	}
	if detail.Run.Error != "" && finalRun.Error == "" {
		finalRun.Error = detail.Run.Error
	}
	userCancellationCommitted := persistedStatus == model.CodexInspectionStatusCancelling &&
		(strings.TrimSpace(persistedError) == userCancelRequestReason || strings.TrimSpace(persistedError) == userCancelledReason)
	if reason == terminationLease {
		finalRun.Status = model.CodexInspectionStatusInterrupted
		finalRun.Error = "巡检任务租约丢失，巡检已中断"
		runErr = nil
	} else if reason == terminationUser || userCancellationCommitted {
		finalRun.Status = model.CodexInspectionStatusCancelled
		finalRun.Error = userCancelledReason
		runErr = nil
	} else if reason == terminationShutdown {
		finalRun.Status = model.CodexInspectionStatusInterrupted
		finalRun.Error = "服务关闭导致巡检已中断"
		runErr = nil
	} else if finalRun.Status == model.CodexInspectionStatusCancelling {
		// A cancellation request can commit its database transition just
		// before this goroutine marks itself finalizing. Treat the persisted
		// cancelling state as authoritative so that race cannot turn a user
		// cancellation into a synthetic failure.
		finalRun.Status = model.CodexInspectionStatusCancelled
		finalRun.Error = userCancelledReason
		runErr = nil
	} else if finalRun.Status == "" || model.IsCodexInspectionRunActive(finalRun.Status) {
		finalRun.Status = model.CodexInspectionStatusFailed
		if finalRun.Error == "" && runErr != nil {
			finalRun.Error = runErr.Error()
		}
	}
	finalRun.FinishedAtMS = time.Now().UnixMilli()
	if finalRun.Error == "" && runErr != nil {
		finalRun.Error = runErr.Error()
	}
	finalRun.Active = false
	finalRun.Cancellable = false
	detail.Run = finalRun
	finalMessage := "凭证健康巡检生命周期已收尾"
	finalLevel := "info"
	switch finalRun.Status {
	case model.CodexInspectionStatusCancelled:
		finalMessage = "凭证健康巡检已取消"
		finalLevel = "warning"
	case model.CodexInspectionStatusInterrupted:
		finalMessage = "凭证健康巡检已中断"
		finalLevel = "warning"
	case model.CodexInspectionStatusFailed:
		finalLevel = "error"
	}
	finalLog := &model.CodexInspectionLog{
		RunID:   run.ID,
		Level:   finalLevel,
		Message: finalMessage,
		Detail: map[string]any{
			"status": finalRun.Status,
			"reason": string(reason),
			"error":  finalRun.Error,
		},
	}
	// Use one bounded budget for the complete terminal transition. Primary,
	// optional-log fallback, fenced recovery, and the post-write read must not
	// each receive a fresh timeout and cumulatively outlive process shutdown.
	finalizeCtx, cancelFinalize := context.WithTimeout(context.Background(), criticalWriteTimeout)
	finalizeErr := s.finalizeInspectionRunWithContext(finalizeCtx, finalRun, finalLog)
	if finalizeErr != nil {
		fallbackErr := s.forceFinalizeInspectionRunWithContext(finalizeCtx, finalRun, finalLog)
		if fallbackErr == nil {
			log.Printf("finalize codex inspection run %d via fenced recovery after primary failure: %v", run.ID, finalizeErr)
			finalizeErr = nil
		} else {
			// Even a fenced/ownership failure must be observable. Another instance
			// may have reclaimed the lease, but if it did not, startup recovery is
			// the only remaining path to repair the active row.
			log.Printf("finalize codex inspection run %d: %v (fallback: %v)", run.ID, finalizeErr, fallbackErr)
			if runErr == nil && !errors.Is(fallbackErr, codexinspectionrepo.ErrLeaseLost) {
				runErr = fallbackErr
			}
		}
	}
	if finalizeErr == nil {
		if finalized, err := s.GetRun(finalizeCtx, run.ID); err == nil {
			if len(detail.Results) > 0 {
				finalized.Results = overlayInspectionResultSnapshots(run.ID, finalized.Results, detail.Results)
			}
			detail = finalized
		} else {
			log.Printf("load finalized codex inspection run %d: %v", run.ID, err)
		}
	} else {
		// The worker is done even when the database could not accept the terminal
		// write. Keep the in-memory result terminal and non-cancellable so callers
		// do not receive a synthetic active task that no goroutine can service.
		results, logs := detail.Results, detail.Logs
		detail = RunDetail{Run: finalRun, Results: results, Logs: logs}
	}
	cancelFinalize()
	task.result = detail
	task.err = runErr
	s.mu.Lock()
	if s.active == task {
		s.active = nil
	}
	s.mu.Unlock()
	close(task.done)
}

// finalizeInspectionRun first attempts the fully atomic terminal update with
// its final lifecycle log. If the log insert itself fails, retry the terminal
// update without that optional log so a logging failure cannot strand the run
// and lease in an active state. Lease ownership errors are returned unchanged:
// another instance may already have fenced this worker.
func (s *Service) finalizeInspectionRun(run model.CodexInspectionRun, finalLog *model.CodexInspectionLog) error {
	finalizeCtx, cancelFinalize := context.WithTimeout(context.Background(), criticalWriteTimeout)
	defer cancelFinalize()
	return s.finalizeInspectionRunWithContext(finalizeCtx, run, finalLog)
}

func (s *Service) finalizeInspectionRunWithContext(ctx context.Context, run model.CodexInspectionRun, finalLog *model.CodexInspectionLog) error {
	if ctx == nil {
		ctx = context.Background()
	}
	err := s.finalizeInspectionRunAttempt(ctx, run, finalLog)
	if err == nil || errors.Is(err, codexinspectionrepo.ErrLeaseLost) || finalLog == nil {
		return err
	}

	log.Printf("final lifecycle log for codex inspection run %d failed: %v; retrying terminal state without log", run.ID, err)
	fallbackErr := s.finalizeInspectionRunAttempt(ctx, run, nil)
	if fallbackErr == nil {
		log.Printf("codex inspection run %d finalized without lifecycle log", run.ID)
		return nil
	}
	return fmt.Errorf("finalize terminal state after lifecycle log failure: %w (initial log error: %v)", fallbackErr, err)
}

func (s *Service) finalizeInspectionRunAttempt(ctx context.Context, run model.CodexInspectionRun, finalLog *model.CodexInspectionLog) error {
	return retryCriticalInspectionWrite(ctx, func() error {
		return s.store.FinalizeCodexInspectionRun(ctx, run, s.ownerID, finalLog)
	})
}

func (s *Service) forceFinalizeInspectionRun(run model.CodexInspectionRun, finalLog *model.CodexInspectionLog) error {
	finalizeCtx, cancelFinalize := context.WithTimeout(context.Background(), criticalWriteTimeout)
	defer cancelFinalize()
	return s.forceFinalizeInspectionRunWithContext(finalizeCtx, run, finalLog)
}

func (s *Service) forceFinalizeInspectionRunWithContext(ctx context.Context, run model.CodexInspectionRun, finalLog *model.CodexInspectionLog) error {
	if ctx == nil {
		ctx = context.Background()
	}
	return retryCriticalInspectionWrite(ctx, func() error {
		return s.store.ForceFinalizeCodexInspectionRun(ctx, run, s.ownerID, finalLog)
	})
}

func retryCriticalInspectionWrite(ctx context.Context, operation func() error) error {
	if ctx == nil {
		ctx = context.Background()
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		lastErr = operation()
		if lastErr == nil || !codexinspectionrepo.IsSQLiteBusyError(lastErr) {
			return lastErr
		}
		if attempt == 2 {
			break
		}
		timer := time.NewTimer(time.Duration(1<<attempt) * 20 * time.Millisecond)
		select {
		case <-ctx.Done():
			stopTimer(timer)
			return ctx.Err()
		case <-timer.C:
		}
	}
	return lastErr
}

func boundedInspectionReadContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), criticalWriteTimeout)
}

func boundedCancelledInspectionContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithTimeout(context.WithoutCancel(ctx), cancelledPersistTimeout)
}

func stopTimer(timer *time.Timer) {
	if timer == nil || timer.Stop() {
		return
	}
	select {
	case <-timer.C:
	default:
	}
}

func (s *Service) heartbeatRun(task *localRun, ctx context.Context, stopped chan<- struct{}) {
	defer close(stopped)
	monitorInterval := s.heartbeatInterval
	if leaseCheckInterval := s.leaseDuration / 4; leaseCheckInterval > 0 && leaseCheckInterval < monitorInterval {
		monitorInterval = leaseCheckInterval
	}
	leaseSafetyMargin := monitorInterval * 2
	if maximumMargin := s.leaseDuration / 2; leaseSafetyMargin > maximumMargin {
		leaseSafetyMargin = maximumMargin
	}
	if leaseSafetyMargin <= 0 {
		leaseSafetyMargin = time.Nanosecond
	}
	ticker := time.NewTicker(monitorInterval)
	defer ticker.Stop()
	lastSuccessfulHeartbeat := task.leaseHeartbeatAt
	if lastSuccessfulHeartbeat.IsZero() {
		lastSuccessfulHeartbeat = time.Now()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			remainingLease := s.leaseDuration - time.Since(lastSuccessfulHeartbeat)
			// Stop before the database lease can become reclaimable. Without this
			// guard, a slow heartbeat call could run past lease expiry while another
			// instance starts the replacement inspection, briefly executing both.
			if remainingLease <= leaseSafetyMargin {
				s.markLeaseLost(task)
				return
			}
			heartbeatTimeout := s.heartbeatInterval
			if maximumTimeout := remainingLease - leaseSafetyMargin; heartbeatTimeout > maximumTimeout {
				heartbeatTimeout = maximumTimeout
			}
			if heartbeatTimeout <= 0 {
				s.markLeaseLost(task)
				return
			}
			heartbeatStartedAt := time.Now()
			heartbeatCtx, cancel := context.WithTimeout(ctx, heartbeatTimeout)
			err := s.store.HeartbeatCodexInspectionRun(heartbeatCtx, task.runID, s.ownerID, s.leaseDuration)
			callTimedOut := errors.Is(heartbeatCtx.Err(), context.DeadlineExceeded)
			cancel()
			if err == nil {
				// The repository timestamps the lease when SQLite executes the
				// statement, which can be later than this call began. Tracking the
				// call start is conservative and prevents lock wait time from being
				// mistaken for additional lease lifetime.
				lastSuccessfulHeartbeat = heartbeatStartedAt
				continue
			}
			if ctx.Err() != nil {
				return
			}
			if errors.Is(err, codexinspectionrepo.ErrLeaseLost) {
				s.markLeaseLost(task)
				return
			}
			if time.Since(lastSuccessfulHeartbeat) >= s.leaseDuration {
				s.markLeaseLost(task)
				return
			}
			if callTimedOut {
				log.Printf("heartbeat codex inspection run %d timed out; lease has not yet expired", task.runID)
				continue
			}
			log.Printf("heartbeat codex inspection run %d: %v", task.runID, err)
		}
	}
}

func (s *Service) markLeaseLost(task *localRun) {
	s.mu.Lock()
	if s.active == task && task.terminationReason == terminationNone {
		task.terminationReason = terminationLease
	}
	s.mu.Unlock()
	task.cancel()
}

func (s *Service) CancelRun(ctx context.Context, runID int64) (RunDetail, error) {
	operationDone, err := s.beginLifecycleOperation()
	if err != nil {
		return RunDetail{}, err
	}
	defer s.finishLifecycleOperation(operationDone)
	if ctx == nil {
		ctx = context.Background()
	}
	// Once an explicit cancellation request reaches the service, its lifecycle
	// transition must not be abandoned merely because the HTTP client disconnects.
	// Keep it bounded so a stuck database still returns control to shutdown.
	cancelCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), criticalWriteTimeout)
	defer cancel()
	return s.cancelRun(cancelCtx, runID)
}

func (s *Service) cancelRun(ctx context.Context, runID int64) (RunDetail, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.Lock()
	task := s.active
	starting := s.starting
	startDone := s.startDone
	if task == nil || task.runID != runID {
		s.mu.Unlock()
		if task == nil && starting && startDone != nil {
			select {
			case <-startDone:
				// The run either became active or the start attempt was
				// finalized as aborted. Re-evaluate ownership now that the
				// short acquisition window has closed.
				return s.cancelRun(ctx, runID)
			case <-ctx.Done():
				return RunDetail{}, ctx.Err()
			}
		}
		detail, err := s.GetRun(ctx, runID)
		if errors.Is(err, ErrRunNotFound) {
			return RunDetail{}, ErrRunNotFound
		}
		if err != nil {
			return RunDetail{}, err
		}
		if detail.Run.Status == model.CodexInspectionStatusCancelled || detail.Run.Status == model.CodexInspectionStatusCancelling {
			return detail, nil
		}
		if model.IsCodexInspectionRunActive(detail.Run.Status) {
			return RunDetail{}, ErrRunNotOwned
		}
		return RunDetail{}, ErrRunNotCancellable
	}
	s.mu.Unlock()
	return s.cancelOwnedRun(ctx, task, runID)
}

func (s *Service) beginLifecycleOperation() (chan struct{}, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopping {
		return nil, ErrServiceStopping
	}
	if s.lifecycleOps == 0 {
		s.lifecycleDone = make(chan struct{})
	}
	s.lifecycleOps++
	return s.lifecycleDone, nil
}

func (s *Service) finishLifecycleOperation(done chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lifecycleOps <= 0 || s.lifecycleDone != done {
		return
	}
	s.lifecycleOps--
	if s.lifecycleOps == 0 {
		close(done)
		s.lifecycleDone = nil
	}
}

func (s *Service) cancelOwnedRun(ctx context.Context, task *localRun, runID int64) (RunDetail, error) {
	// Serialize cancellation requests without holding the service state mutex
	// across SQLite I/O. This keeps heartbeat, shutdown, and finalization
	// responsive while a busy database is being retried.
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()

	s.mu.Lock()
	if s.active != task || task.runID != runID {
		s.mu.Unlock()
		return s.cancelRunFromStore(ctx, runID)
	}
	if task.finalizing {
		s.mu.Unlock()
		detail, err := s.getRunForLifecycle(runID)
		if err != nil {
			return RunDetail{}, err
		}
		if detail.Run.Status == model.CodexInspectionStatusCancelling || detail.Run.Status == model.CodexInspectionStatusCancelled {
			return detail, nil
		}
		return RunDetail{}, ErrRunNotCancellable
	}
	if task.terminationReason == terminationUser {
		cancel := task.cancel
		s.mu.Unlock()
		cancel()
		return s.getRunForLifecycle(runID)
	}
	if task.terminationReason != terminationNone {
		s.mu.Unlock()
		return RunDetail{}, ErrRunNotCancellable
	}
	s.mu.Unlock()

	markCtx, cancelMark := context.WithTimeout(ctx, criticalWriteTimeout)
	defer cancelMark()
	changed, err := s.store.MarkCodexInspectionRunCancelling(markCtx, runID, s.ownerID, userCancelRequestReason)

	s.mu.Lock()
	stillOwned := s.active == task && !task.finalizing
	if errors.Is(err, codexinspectionrepo.ErrLeaseLost) {
		if stillOwned {
			task.terminationReason = terminationLease
		}
		cancel := task.cancel
		s.mu.Unlock()
		cancel()
		return RunDetail{}, ErrRunNotOwned
	}
	if err != nil {
		s.mu.Unlock()
		return RunDetail{}, err
	}
	if !stillOwned {
		s.mu.Unlock()
		return s.cancelRunFromStoreWithBound(runID)
	}
	if task.terminationReason != terminationNone {
		s.mu.Unlock()
		return RunDetail{}, ErrRunNotCancellable
	}
	if !changed {
		s.mu.Unlock()
		detail, detailErr := s.cancelRunFromStoreWithBound(runID)
		if detailErr != nil {
			return RunDetail{}, detailErr
		}
		if detail.Run.Status == model.CodexInspectionStatusCancelled {
			return detail, nil
		}
		if detail.Run.Status != model.CodexInspectionStatusCancelling {
			// The worker can commit a terminal state between the ownership check
			// above and the cancelling transition. Do not turn that completed/failed
			// run into a successful cancellation response.
			return RunDetail{}, ErrRunNotCancellable
		}
		// A previous request may already have committed `cancelling` while
		// this local task still owns the lease. Complete the same idempotent
		// cancellation locally instead of returning a spurious conflict.
		s.mu.Lock()
		if s.active == task && !task.finalizing && task.terminationReason == terminationNone {
			task.terminationReason = terminationUser
			cancel := task.cancel
			s.mu.Unlock()
			cancel()
			return detail, nil
		}
		s.mu.Unlock()
		return detail, nil
	}
	task.terminationReason = terminationUser
	cancel := task.cancel
	cancel()
	s.mu.Unlock()
	detail, err := s.getRunForLifecycle(runID)
	if err != nil {
		return RunDetail{}, err
	}
	return detail, nil
}

func (s *Service) cancelRunFromStore(ctx context.Context, runID int64) (RunDetail, error) {
	detail, err := s.GetRun(ctx, runID)
	if err != nil {
		return RunDetail{}, err
	}
	if detail.Run.Status == model.CodexInspectionStatusCancelled || detail.Run.Status == model.CodexInspectionStatusCancelling {
		return detail, nil
	}
	if model.IsCodexInspectionRunActive(detail.Run.Status) {
		return RunDetail{}, ErrRunNotOwned
	}
	return RunDetail{}, ErrRunNotCancellable
}

func (s *Service) cancelRunFromStoreWithBound(runID int64) (RunDetail, error) {
	readCtx, cancelRead := boundedInspectionReadContext()
	defer cancelRead()
	return s.cancelRunFromStore(readCtx, runID)
}

func (s *Service) getRunForLifecycle(runID int64) (RunDetail, error) {
	readCtx, cancelRead := boundedInspectionReadContext()
	defer cancelRead()
	return s.GetRun(readCtx, runID)
}

func (s *Service) Recover(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	_, err := s.store.RecoverStaleCodexInspectionRuns(ctx, time.Now().UnixMilli(), "服务重启或任务租约过期，巡检已中断")
	return err
}

func (s *Service) StopAndWait(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	var task *localRun
	for {
		s.mu.Lock()
		s.stopping = true
		startDone := s.startDone
		startCancel := s.startCancel
		auxiliaryDone := s.auxiliaryDone
		auxiliaryCancel := s.auxiliaryCancel
		lifecycleDone := s.lifecycleDone
		task = s.active
		if task != nil && !task.finalizing && task.terminationReason == terminationNone {
			task.terminationReason = terminationShutdown
		}
		var taskCancel context.CancelFunc
		if task != nil && !task.finalizing {
			taskCancel = task.cancel
		}
		s.mu.Unlock()
		if startCancel != nil {
			startCancel()
		}
		if auxiliaryCancel != nil {
			auxiliaryCancel()
		}
		if taskCancel != nil {
			taskCancel()
		}
		if startDone == nil {
			if auxiliaryDone != nil {
				select {
				case <-auxiliaryDone:
				case <-ctx.Done():
					return ctx.Err()
				}
				continue
			}
			if lifecycleDone != nil {
				select {
				case <-lifecycleDone:
				case <-ctx.Done():
					return ctx.Err()
				}
				continue
			}
			break
		}
		select {
		case <-startDone:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if task == nil {
		return nil
	}
	task.cancel()
	select {
	case <-task.done:
		return nil
	case <-ctx.Done():
		log.Printf("timed out waiting for codex inspection run %d to stop: %v", task.runID, ctx.Err())
		return ctx.Err()
	}
}

func (s *Service) ActiveRunID() (int64, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil {
		return 0, false
	}
	return s.active.runID, true
}

func (s *Service) IsStopping() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stopping
}

func (s *Service) localRunCancellable(runID int64, status string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil || s.active.runID != runID {
		return false
	}
	if s.active.finalizing {
		// A committed cancellation remains idempotently cancellable while the
		// worker is performing its final database transaction. This keeps the UI
		// on the disabled "cancelling" action instead of hiding it mid-transition.
		return status == model.CodexInspectionStatusCancelling
	}
	return s.active.terminationReason == terminationNone || s.active.terminationReason == terminationUser
}

func (s *Service) ListRuns(ctx context.Context, limit int) ([]model.CodexInspectionRun, error) {
	runs, err := s.store.ListCodexInspectionRuns(ctx, limit)
	if err != nil {
		return nil, err
	}
	lease, active, err := s.store.GetActiveCodexInspectionLease(ctx, time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	for index := range runs {
		runs[index].Active = active && lease.RunID == runs[index].ID && model.IsCodexInspectionRunActive(runs[index].Status)
		runs[index].Cancellable = runs[index].Active && lease.OwnerID == s.ownerID && s.localRunCancellable(runs[index].ID, runs[index].Status)
	}
	return runs, nil
}

func (s *Service) GetRun(ctx context.Context, id int64) (RunDetail, error) {
	run, ok, err := s.store.GetCodexInspectionRun(ctx, id)
	if err != nil {
		return RunDetail{}, err
	}
	if !ok {
		return RunDetail{}, ErrRunNotFound
	}
	lease, active, err := s.store.GetActiveCodexInspectionLease(ctx, time.Now().UnixMilli())
	if err != nil {
		return RunDetail{}, err
	}
	run.Active = active && lease.RunID == run.ID && model.IsCodexInspectionRunActive(run.Status)
	run.Cancellable = run.Active && lease.OwnerID == s.ownerID && s.localRunCancellable(run.ID, run.Status)
	results, err := s.store.ListCodexInspectionResults(ctx, id)
	if err != nil {
		return RunDetail{}, err
	}
	logs, err := s.store.ListCodexInspectionLogs(ctx, id)
	if err != nil {
		return RunDetail{}, err
	}
	return RunDetail{Run: run, Results: results, Logs: logs}, nil
}

func (s *Service) ExecuteManualActions(ctx context.Context, runID int64, req ExecuteActionsRequest) (ExecuteActionsResult, error) {
	operationCtx, err := s.acquireAuxiliaryRun(ctx)
	if err != nil {
		return ExecuteActionsResult{}, err
	}
	defer s.releaseRun()
	ctx = operationCtx

	if len(req.ResultIDs) == 0 {
		return ExecuteActionsResult{}, ErrActionIDsRequired
	}

	settings, setup, err := s.resolveRuntime(ctx)
	if err != nil {
		return ExecuteActionsResult{}, err
	}
	detail, err := s.GetRun(ctx, runID)
	if err != nil {
		return ExecuteActionsResult{}, err
	}
	if detail.Run.Status != model.CodexInspectionStatusCompleted {
		return ExecuteActionsResult{}, ErrRunNotCompleted
	}
	if len(detail.Run.Settings.TargetProviders()) > 0 {
		settings = detail.Run.Settings
	}

	selected := map[int64]struct{}{}
	for _, id := range req.ResultIDs {
		if id > 0 {
			selected[id] = struct{}{}
		}
	}
	if len(selected) == 0 {
		return ExecuteActionsResult{}, ErrActionIDsRequired
	}

	manualResults, err := applyManualActionOverrides(detail.Results, selected, req.ActionOverrides)
	if err != nil {
		return ExecuteActionsResult{}, err
	}
	items, preflightOutcomes := selectManualActionItems(manualResults, selected)
	if len(items) == 0 && len(preflightOutcomes) == 0 {
		return ExecuteActionsResult{}, ErrNoActionableResults
	}

	// Keep lifecycle/result writes independent from a disconnected HTTP request,
	// but give the whole post-action persistence phase one finite budget so
	// shutdown cannot wait forever on a locked SQLite writer.
	persistCtx, cancelPersist := context.WithTimeout(context.WithoutCancel(ctx), resultPersistenceTimeout)
	defer cancelPersist()
	logger := runLogger{service: s, runID: detail.Run.ID}
	logger.info(persistCtx, "手动处理账号开始", map[string]any{
		"requestedCount": len(req.ResultIDs),
		"actionCount":    len(items),
	})
	logPreflightActionOutcomes(persistCtx, logger, "手动处理", preflightOutcomes)

	validItems, validationOutcomes, err := s.validateActionItems(
		ctx,
		persistCtx,
		setup,
		items,
		logger,
		"手动处理",
		func(item model.CodexInspectionResult) string { return item.Action },
	)
	if err != nil {
		return ExecuteActionsResult{}, err
	}
	outcomes := make([]ActionOutcome, 0, len(preflightOutcomes)+len(validationOutcomes)+len(validItems))
	outcomes = append(outcomes, preflightOutcomes...)
	outcomes = append(outcomes, validationOutcomes...)
	outcomes = append(outcomes, s.executeActionItems(ctx, setup, settings, validItems, logger, "手动处理", false, func(item model.CodexInspectionResult) string {
		return item.Action
	})...)
	if len(outcomes) == 0 {
		return ExecuteActionsResult{}, ErrNoActionableResults
	}
	nextResults := applyActionOutcomes(detail.Results, outcomes)
	resultWriteFailures := s.persistInspectionResults(persistCtx, detail.Run.ID, nextResults, logger)

	run := summarizeRun(detail.Run, nextResults)
	outcomeSummary := summarizeActionOutcomes(outcomes)
	failedActions := outcomeSummary.Failed
	runErrors := make([]string, 0, 2)
	if failedActions > 0 {
		runErrors = append(runErrors, fmt.Sprintf("%d 个手动处理动作执行失败，详见巡检日志", failedActions))
	}
	if resultWriteFailures > 0 {
		runErrors = append(runErrors, fmt.Sprintf("%d 个巡检结果写入失败，详见巡检日志", resultWriteFailures))
	}
	run.Error = strings.Join(runErrors, "；")
	if err := s.store.UpdateCodexInspectionRun(persistCtx, run); err != nil {
		return ExecuteActionsResult{}, err
	}
	completionDetail := map[string]any{
		"successCount":           outcomeSummary.Success,
		"failedCount":            outcomeSummary.Failed,
		"skippedCount":           outcomeSummary.Skipped,
		"needsReviewCount":       outcomeSummary.NeedsReview,
		"resultWriteFailedCount": resultWriteFailures,
	}
	if failedActions > 0 || outcomeSummary.NeedsReview > 0 || resultWriteFailures > 0 {
		logger.warning(persistCtx, "手动处理账号完成", completionDetail)
	} else {
		logger.success(persistCtx, "手动处理账号完成", completionDetail)
	}

	nextDetail, err := s.getRunWithResultFallback(
		persistCtx,
		detail.Run.ID,
		nextResults,
		resultWriteFailures > 0,
	)
	if err != nil {
		return ExecuteActionsResult{}, err
	}
	return ExecuteActionsResult{Outcomes: outcomes, Detail: nextDetail}, nil
}

func applyManualActionOverrides(
	results []model.CodexInspectionResult,
	selected map[int64]struct{},
	overrides []ManualActionOverride,
) ([]model.CodexInspectionResult, error) {
	if len(overrides) == 0 {
		return results, nil
	}
	overrideByID := make(map[int64]string, len(overrides))
	for _, override := range overrides {
		action := strings.ToLower(strings.TrimSpace(override.Action))
		if override.ResultID <= 0 || action != "delete" {
			return nil, ErrInvalidActionOverride
		}
		if _, ok := selected[override.ResultID]; !ok {
			return nil, ErrInvalidActionOverride
		}
		if existing, ok := overrideByID[override.ResultID]; ok && existing != action {
			return nil, ErrInvalidActionOverride
		}
		overrideByID[override.ResultID] = action
	}

	out := make([]model.CodexInspectionResult, len(results))
	copy(out, results)
	matched := make(map[int64]struct{}, len(overrideByID))
	for index := range out {
		action, ok := overrideByID[out[index].ID]
		if !ok {
			continue
		}
		if out[index].Action != "reauth" || action != "delete" {
			return nil, ErrInvalidActionOverride
		}
		out[index].Action = "delete"
		matched[out[index].ID] = struct{}{}
	}
	if len(matched) != len(overrideByID) {
		return nil, ErrInvalidActionOverride
	}
	return out, nil
}

func (s *Service) ResolveConfig(ctx context.Context) (model.ManagerCodexInspectionConfig, bool, error) {
	if s.managerConfigService == nil {
		return model.DefaultCodexInspectionConfig(), false, nil
	}
	managerCfg, _, ok, err := s.managerConfigService.ResolveManagerConfigWithSource(ctx)
	if err != nil {
		return model.ManagerCodexInspectionConfig{}, false, err
	}
	if !ok || strings.TrimSpace(managerCfg.CPAConnection.CPABaseURL) == "" ||
		strings.TrimSpace(managerCfg.CPAConnection.ManagementKey) == "" {
		return model.DefaultCodexInspectionConfig(), false, nil
	}
	return model.NormalizeCodexInspectionConfig(
		managerCfg.CodexInspection,
		model.DefaultCodexInspectionConfig(),
	), true, nil
}

func (s *Service) acquireAuxiliaryRun(ctx context.Context) (context.Context, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	operationCtx, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopping {
		cancel()
		return nil, ErrServiceStopping
	}
	if s.starting || s.active != nil || s.auxiliaryRunning {
		cancel()
		return nil, ErrRunAlreadyActive
	}
	s.auxiliaryRunning = true
	s.auxiliaryDone = make(chan struct{})
	s.auxiliaryCancel = cancel
	return operationCtx, nil
}

func (s *Service) releaseRun() {
	s.mu.Lock()
	done := s.auxiliaryDone
	cancel := s.auxiliaryCancel
	s.auxiliaryDone = nil
	s.auxiliaryCancel = nil
	s.auxiliaryRunning = false
	if done != nil {
		close(done)
	}
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *Service) resolveRuntime(ctx context.Context) (model.ManagerCodexInspectionConfig, store.Setup, error) {
	if s.managerConfigService == nil {
		return model.ManagerCodexInspectionConfig{}, store.Setup{}, ErrNotConfigured
	}
	managerCfg, _, ok, err := s.managerConfigService.ResolveManagerConfigWithSource(ctx)
	if err != nil {
		return model.ManagerCodexInspectionConfig{}, store.Setup{}, err
	}
	if !ok || strings.TrimSpace(managerCfg.CPAConnection.CPABaseURL) == "" ||
		strings.TrimSpace(managerCfg.CPAConnection.ManagementKey) == "" {
		return model.ManagerCodexInspectionConfig{}, store.Setup{}, ErrNotConfigured
	}
	settings := model.NormalizeCodexInspectionConfig(
		managerCfg.CodexInspection,
		model.DefaultCodexInspectionConfig(),
	)
	return settings, managerconfig.SetupFromManagerConfig(managerCfg), nil
}

func (s *Service) failRun(ctx context.Context, run model.CodexInspectionRun, cause error) (RunDetail, error) {
	run.Status = model.CodexInspectionStatusFailed
	run.Error = cause.Error()
	run.FinishedAtMS = time.Now().UnixMilli()
	detail, err := s.GetRun(ctx, run.ID)
	if err != nil {
		return RunDetail{Run: run}, cause
	}
	detail.Run = run
	return detail, cause
}

func (s *Service) fetchAuthFiles(ctx context.Context, setup store.Setup) ([]authFile, error) {
	files, err := cpaauthfiles.New(s.client).Fetch(ctx, setup.CPAUpstreamURL, setup.ManagementKey)
	if err != nil {
		return nil, err
	}
	result := make([]authFile, 0, len(files))
	for _, file := range files {
		result = append(result, authFile(file.Raw))
	}
	return result, nil
}

func (s *Service) inspectAccounts(
	ctx context.Context,
	setup store.Setup,
	settings model.ManagerCodexInspectionConfig,
	accounts []account,
	logger runLogger,
) []model.CodexInspectionResult {
	if len(accounts) == 0 {
		return nil
	}
	workers := settings.Workers
	if workers <= 0 {
		workers = 1
	}

	jobs := make(chan account)
	results := make(chan model.CodexInspectionResult, len(accounts))
	var wg sync.WaitGroup
	for i := 0; i < workers && i < len(accounts); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range jobs {
				results <- s.inspectSingleAccount(ctx, setup, settings, item, logger)
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, item := range accounts {
			select {
			case <-ctx.Done():
				return
			case jobs <- item:
			}
		}
	}()

	wg.Wait()
	close(results)

	out := make([]model.CodexInspectionResult, 0, len(accounts))
	for result := range results {
		out = append(out, result)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].FileName == out[j].FileName {
			return out[i].DisplayAccount < out[j].DisplayAccount
		}
		return out[i].FileName < out[j].FileName
	})
	return out
}

func (s *Service) inspectSingleAccount(
	ctx context.Context,
	setup store.Setup,
	settings model.ManagerCodexInspectionConfig,
	item account,
	logger runLogger,
) model.CodexInspectionResult {
	if item.Provider == "xai" {
		return s.inspectSingleXAIAccount(ctx, setup, settings, item, logger)
	}
	base := resultFromAccount(item)
	if item.AuthIndex == "" {
		base.Action = "keep"
		base.ActionReason = "缺少 auth_index，保留账号"
		base.Error = "缺少 auth_index"
		base.ErrorKind = "missing_auth_index"
		base.ErrorDetail = "缺少 auth_index"
		logger.warning(ctx, "账号缺少 auth_index，跳过探测", map[string]any{
			"fileName":       item.FileName,
			"displayAccount": item.DisplayAccount,
		})
		return base
	}

	var response apiCallResponse
	var err error
	for attempt := 0; attempt <= settings.Retries; attempt++ {
		response, err = s.requestCodexUsage(ctx, setup, settings, item)
		if err == nil {
			break
		}
	}
	if err != nil {
		base.Action = "keep"
		base.ActionReason = "探测异常，保留账号"
		base.Error = truncate(err.Error(), maxStoredBodyText)
		base.ErrorKind = "request_error"
		base.ErrorDetail = truncate(err.Error(), maxStoredBodyText)
		logger.warning(ctx, "账号探测异常，保留账号", map[string]any{
			"fileName":       item.FileName,
			"displayAccount": item.DisplayAccount,
			"error":          err.Error(),
		})
		return base
	}
	if !response.HasStatusCode {
		base.Action = "keep"
		base.ActionReason = "探测响应缺少 status_code，保留账号"
		base.Error = "响应缺少 status_code"
		base.ErrorKind = "missing_status"
		base.ErrorDetail = firstNonEmpty(truncate(response.BodyText, maxStoredBodyText), "响应缺少 status_code")
		logger.warning(ctx, "账号探测未返回 status_code，保留账号", map[string]any{
			"fileName":       item.FileName,
			"displayAccount": item.DisplayAccount,
			"body":           truncate(response.BodyText, maxStoredBodyText),
		})
		return base
	}

	statusCode := response.StatusCode
	base.StatusCode = &statusCode
	payload := parseRecord(response.Body)
	if payload == nil {
		payload = parseRecord(response.BodyText)
	}
	planType := normalizeCodexPlanType(readString(payload, "plan_type", "planType"))
	if planType == "" {
		planType = resolveCodexPlanType(item.File)
	}
	rateLimit := parseRateLimit(readMap(payload, "rate_limit", "rateLimit"))
	usedPercent := deriveRateLimitUsedPercent(rateLimit)
	bodyLower := strings.ToLower(response.BodyText)
	isQuota := statusCode == http.StatusPaymentRequired ||
		strings.Contains(bodyLower, "quota exhausted") ||
		strings.Contains(bodyLower, "limit reached") ||
		strings.Contains(bodyLower, "payment_required") ||
		isRateLimitReached(rateLimit) ||
		(usedPercent != nil && *usedPercent >= settings.UsedPercentThreshold)
	decision := resolveProbeAction(item, statusCode, response.BodyText, rateLimit, usedPercent, isQuota, settings.UsedPercentThreshold, planType)

	base.Action = decision.Action
	base.ActionReason = decision.ActionReason
	base.UsedPercent = decision.UsedPercent
	base.IsQuota = decision.IsQuota
	base.AutoRecoverEligible = decision.Action == "enable" && item.AutoRecoverOwned
	if decision.Action == "enable" && !base.AutoRecoverEligible {
		base.ActionReason += "；禁用来源不受巡检管理，仅允许手动启用"
	}
	base.PlanType = planType
	base.QuotaWindows = buildCodexInspectionQuotaWindows(payload, planType)
	base.Error = ""
	if statusCode < 200 || statusCode >= 300 {
		base.ErrorKind = "http_status"
		base.ErrorDetail = firstNonEmpty(truncate(response.BodyText, maxStoredBodyText), fmt.Sprintf("HTTP %d", statusCode))
	}

	level := "info"
	switch decision.Action {
	case "delete", "reauth":
		level = "error"
	case "disable":
		level = "warning"
	case "enable":
		level = "success"
	}
	logger.log(ctx, level, "账号探测完成", map[string]any{
		"fileName":       item.FileName,
		"displayAccount": item.DisplayAccount,
		"action":         decision.Action,
		"statusCode":     statusCode,
		"usedPercent":    nullableFloat(decision.UsedPercent),
		"isQuota":        decision.IsQuota,
	})
	return base
}

func (s *Service) requestCodexUsage(
	ctx context.Context,
	setup store.Setup,
	settings model.ManagerCodexInspectionConfig,
	item account,
) (apiCallResponse, error) {
	result, _, err := s.requestCodexUsageAt(ctx, setup, settings, item, "/v0/management/api-call")
	return result, err
}

func (s *Service) requestCodexUsageAt(
	ctx context.Context,
	setup store.Setup,
	settings model.ManagerCodexInspectionConfig,
	item account,
	path string,
) (apiCallResponse, int, error) {
	headers := map[string]string{
		"Authorization": "Bearer $TOKEN$",
		"Content-Type":  "application/json",
		"User-Agent":    settings.UserAgent,
	}
	if strings.TrimSpace(item.AccountID) != "" {
		headers["Chatgpt-Account-Id"] = strings.TrimSpace(item.AccountID)
	}
	payload := map[string]any{
		"authIndex": item.AuthIndex,
		"method":    http.MethodGet,
		"url":       codexUsageURL,
		"header":    headers,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return apiCallResponse{}, 0, err
	}
	requestCtx := ctx
	cancel := func() {}
	if settings.Timeout > 0 {
		requestCtx, cancel = context.WithTimeout(ctx, time.Duration(settings.Timeout)*time.Millisecond)
	}
	defer cancel()

	req, err := http.NewRequestWithContext(
		requestCtx,
		http.MethodPost,
		cpa.NormalizeBaseURL(setup.CPAUpstreamURL)+path,
		bytes.NewReader(data),
	)
	if err != nil {
		return apiCallResponse{}, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+setup.ManagementKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return apiCallResponse{}, 0, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, maxStoredBodyText))
		return apiCallResponse{}, res.StatusCode, fmt.Errorf("api-call failed: %s %s", res.Status, truncate(string(body), maxStoredBodyText))
	}

	var raw map[string]any
	if err := decodeCPAAPICallResponse(res.Body, maxCPAAPICallResponseSize, &raw); err != nil {
		return apiCallResponse{}, res.StatusCode, err
	}
	statusRaw, hasStatus := firstValue(raw, "status_code", "statusCode")
	statusCode := int(readFloat(statusRaw, 0))
	bodyRaw, _ := firstValue(raw, "body")
	bodyText, bodyValue := normalizeBody(bodyRaw)
	return apiCallResponse{
		StatusCode:    statusCode,
		HasStatusCode: hasStatus && strings.TrimSpace(fmt.Sprint(statusRaw)) != "",
		BodyText:      bodyText,
		Body:          bodyValue,
	}, res.StatusCode, nil
}

func decodeCPAAPICallResponse(body io.Reader, maxBytes int64, target any) error {
	if body == nil {
		return io.EOF
	}
	if maxBytes <= 0 {
		return errors.New("CPA api-call response size limit must be positive")
	}
	limited := &io.LimitedReader{R: body, N: maxBytes + 1}
	decoder := json.NewDecoder(limited)
	if err := decoder.Decode(target); err != nil {
		if limited.N == 0 {
			return fmt.Errorf("%w: exceeds %d bytes", errCPAAPICallResponseTooLarge, maxBytes)
		}
		return err
	}
	if limited.N == 0 {
		return fmt.Errorf("%w: exceeds %d bytes", errCPAAPICallResponseTooLarge, maxBytes)
	}
	var trailing any
	trailingErr := decoder.Decode(&trailing)
	if limited.N == 0 {
		return fmt.Errorf("%w: exceeds %d bytes", errCPAAPICallResponseTooLarge, maxBytes)
	}
	if errors.Is(trailingErr, io.EOF) {
		return nil
	}
	if trailingErr == nil {
		return errors.New("api-call response contains multiple JSON values")
	}
	return fmt.Errorf("decode api-call response trailing data: %w", trailingErr)
}

func (s *Service) executeAutoActions(
	ctx context.Context,
	setup store.Setup,
	settings model.ManagerCodexInspectionConfig,
	results []model.CodexInspectionResult,
	logger runLogger,
) []ActionOutcome {
	mode := model.NormalizeCodexInspectionAutoActionMode(settings.AutoActionMode, model.CodexInspectionAutoActionNone)
	if mode == model.CodexInspectionAutoActionNone && !settings.AutoRecoverEnabled {
		return nil
	}
	items, preflightOutcomes := selectAutoActionItems(mode, settings.AutoRecoverEnabled, results)
	logCtx := context.WithoutCancel(ctx)
	requestedCount := len(items) + len(preflightOutcomes)
	if requestedCount == 0 {
		requestedCount = countSuggestedActionResults(results)
	}
	if requestedCount == 0 {
		return nil
	}
	logger.info(logCtx, "自动处理账号开始", map[string]any{
		"requestedCount": requestedCount,
		"actionCount":    len(items),
	})
	logPreflightActionOutcomes(logCtx, logger, "自动处理", preflightOutcomes)
	actionFor := func(item model.CodexInspectionResult) string {
		return resolveExecutableAction(mode, item.Action)
	}
	validItems, validationOutcomes, validationErr := s.validateActionItems(
		ctx,
		logCtx,
		setup,
		items,
		logger,
		"自动处理",
		actionFor,
	)
	if validationErr != nil {
		validationOutcomes = completeCanceledActionOutcomes(
			items,
			validationOutcomes,
			actionFor,
			validationErr,
			logger,
			logCtx,
			"自动处理",
		)
		validItems = nil
	}
	outcomes := make([]ActionOutcome, 0, len(preflightOutcomes)+len(validationOutcomes)+len(validItems))
	outcomes = append(outcomes, preflightOutcomes...)
	outcomes = append(outcomes, validationOutcomes...)
	if len(validItems) > 0 {
		outcomes = append(outcomes, s.executeActionItems(ctx, setup, settings, validItems, logger, "自动处理", true, actionFor)...)
	}
	summary := summarizeActionOutcomes(outcomes)
	remainingCount := countPendingActionResults(results, outcomes)
	completionDetail := map[string]any{
		"successCount":     summary.Success,
		"failedCount":      summary.Failed,
		"skippedCount":     summary.Skipped,
		"needsReviewCount": summary.NeedsReview,
		"remainingCount":   remainingCount,
	}
	if summary.Failed > 0 || summary.NeedsReview > 0 || remainingCount > 0 {
		logger.warning(logCtx, "自动处理账号完成", completionDetail)
	} else {
		logger.success(logCtx, "自动处理账号完成", completionDetail)
	}
	return outcomes
}

func countSuggestedActionResults(results []model.CodexInspectionResult) int {
	count := 0
	for _, result := range results {
		if result.Action != "" && result.Action != "keep" {
			count++
		}
	}
	return count
}

func countPendingActionResults(results []model.CodexInspectionResult, outcomes []ActionOutcome) int {
	terminal := make(map[string]struct{}, len(outcomes))
	for _, outcome := range outcomes {
		switch outcome.Status {
		case model.CodexInspectionActionStatusSuccess,
			model.CodexInspectionActionStatusSkipped,
			model.CodexInspectionActionStatusNeedsReview:
			terminal[outcome.AccountKey] = struct{}{}
		}
	}
	count := 0
	for _, result := range results {
		if result.Action == "" || result.Action == "keep" {
			continue
		}
		if _, ok := terminal[result.AccountKey]; ok {
			continue
		}
		count++
	}
	return count
}

func (s *Service) executeActionItems(
	ctx context.Context,
	setup store.Setup,
	settings model.ManagerCodexInspectionConfig,
	items []model.CodexInspectionResult,
	logger runLogger,
	logPrefix string,
	automatic bool,
	actionFor func(model.CodexInspectionResult) string,
) []ActionOutcome {
	logCtx := context.WithoutCancel(ctx)
	workers := settings.DeleteWorkers
	if workers <= 0 {
		workers = 1
	}
	jobs := make(chan model.CodexInspectionResult)
	outcomes := make(chan ActionOutcome, len(items))
	var wg sync.WaitGroup
	for i := 0; i < workers && i < len(items); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case item, ok := <-jobs:
					if !ok {
						return
					}
					action := item.Action
					if actionFor != nil {
						action = actionFor(item)
					}
					if action == "" {
						action = item.Action
					}
					actionItem := item
					actionItem.Action = action
					outcome := ActionOutcome{
						ResultID:        item.ID,
						AccountKey:      item.AccountKey,
						FileName:        item.FileName,
						DisplayAccount:  item.DisplayAccount,
						Action:          action,
						CurrentDisabled: boolPointer(item.Disabled),
					}
					if err := s.executeAction(ctx, setup, actionItem, automatic); err != nil {
						outcome.Success = false
						outcome.Status = model.CodexInspectionActionStatusFailed
						outcome.Error = err.Error()
						outcomes <- outcome
						logger.error(logCtx, logPrefix+"账号失败", map[string]any{
							"fileName":       item.FileName,
							"displayAccount": item.DisplayAccount,
							"action":         action,
							"error":          err.Error(),
						})
						continue
					}
					outcome.Success = true
					outcome.Status = model.CodexInspectionActionStatusSuccess
					outcomes <- outcome
					logger.success(logCtx, logPrefix+"账号成功", map[string]any{
						"fileName":       item.FileName,
						"displayAccount": item.DisplayAccount,
						"action":         action,
					})
				}
			}
		}()
	}
	for _, item := range items {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			close(outcomes)
			return completeCanceledActionOutcomes(
				items,
				collectActionOutcomes(outcomes, len(items)),
				actionFor,
				ctx.Err(),
				logger,
				logCtx,
				logPrefix,
			)
		case jobs <- item:
		}
	}
	close(jobs)
	wg.Wait()
	close(outcomes)

	return completeCanceledActionOutcomes(
		items,
		collectActionOutcomes(outcomes, len(items)),
		actionFor,
		ctx.Err(),
		logger,
		logCtx,
		logPrefix,
	)
}

func collectActionOutcomes(outcomes <-chan ActionOutcome, capacity int) []ActionOutcome {
	result := make([]ActionOutcome, 0, capacity)
	for outcome := range outcomes {
		result = append(result, outcome)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].FileName == result[j].FileName {
			return result[i].Action < result[j].Action
		}
		return result[i].FileName < result[j].FileName
	})
	return result
}

func completeCanceledActionOutcomes(
	items []model.CodexInspectionResult,
	outcomes []ActionOutcome,
	actionFor func(model.CodexInspectionResult) string,
	cause error,
	logger runLogger,
	logCtx context.Context,
	logPrefix string,
) []ActionOutcome {
	if cause == nil || len(outcomes) >= len(items) {
		return outcomes
	}
	completed := make(map[string]struct{}, len(outcomes))
	for _, outcome := range outcomes {
		completed[outcome.AccountKey] = struct{}{}
	}
	for _, item := range items {
		if _, ok := completed[item.AccountKey]; ok {
			continue
		}
		action := item.Action
		if actionFor != nil {
			action = actionFor(item)
		}
		message := fmt.Sprintf("动作未执行：%v", cause)
		outcome := failedActionOutcome(item, action, message)
		outcomes = append(outcomes, outcome)
		logger.error(logCtx, logPrefix+"账号失败", map[string]any{
			"fileName":       item.FileName,
			"displayAccount": item.DisplayAccount,
			"action":         action,
			"error":          message,
		})
	}
	sort.Slice(outcomes, func(i, j int) bool {
		if outcomes[i].FileName == outcomes[j].FileName {
			return outcomes[i].Action < outcomes[j].Action
		}
		return outcomes[i].FileName < outcomes[j].FileName
	})
	return outcomes
}

func (s *Service) executeAction(ctx context.Context, setup store.Setup, item model.CodexInspectionResult, automatic bool) error {
	var revokedOwnership []store.CodexInspectionDisableOwnership
	shouldRevokeOwnership := item.Action == "enable" || item.Action == "delete" || (item.Action == "disable" && !automatic)
	if shouldRevokeOwnership {
		var err error
		revokedOwnership, err = s.store.RevokeCodexInspectionDisableOwnership(ctx, []string{item.FileName}, false)
		if err != nil {
			return fmt.Errorf("revoke inspection disable ownership: %w", err)
		}
	}

	var actionErr error
	switch item.Action {
	case "delete":
		actionErr = s.deleteAuthFileOnly(ctx, setup, "/v0/management/auth-files", item.FileName)
	case "disable", "enable":
		disabled := item.Action == "disable"
		payload := map[string]any{"name": item.FileName, "disabled": disabled}
		actionErr, _ = s.patchAuthFile(ctx, setup, "/v0/management/auth-files/status", payload)
	default:
		return nil
	}
	if actionErr != nil {
		restoreCtx, cancelRestore := context.WithTimeout(context.WithoutCancel(ctx), resultPersistenceTimeout)
		restoreErr := s.store.RestoreCodexInspectionDisableOwnership(restoreCtx, revokedOwnership)
		cancelRestore()
		if restoreErr != nil {
			return fmt.Errorf("%w; restore inspection disable ownership: %v", actionErr, restoreErr)
		}
		return actionErr
	}

	switch item.Action {
	case "disable":
		if !automatic {
			return nil
		}
		if item.Disabled {
			return nil
		}
		if err := s.store.UpsertCodexInspectionDisableOwnership(ctx, model.CodexInspectionDisableOwnership{
			FileName:     item.FileName,
			Provider:     item.Provider,
			AuthIndex:    item.AuthIndex,
			AccountID:    item.AccountID,
			DisabledAtMS: time.Now().UnixMilli(),
		}); err != nil {
			rollbackErr, _ := s.patchAuthFile(ctx, setup, "/v0/management/auth-files/status", map[string]any{
				"name":     item.FileName,
				"disabled": false,
			})
			if rollbackErr != nil {
				return fmt.Errorf("persist inspection disable ownership: %w; rollback enable failed: %v", err, rollbackErr)
			}
			return fmt.Errorf("persist inspection disable ownership: %w", err)
		}
	}
	return nil
}

func (s *Service) deleteAuthFileOnly(ctx context.Context, setup store.Setup, path string, fileName string) error {
	err, _ := s.deleteAuthFile(ctx, setup, path, fileName)
	return err
}

func (s *Service) deleteAuthFile(ctx context.Context, setup store.Setup, path string, fileName string) (error, int) {
	endpoint := cpa.NormalizeBaseURL(setup.CPAUpstreamURL) + path + "?name=" + url.QueryEscape(fileName)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err, 0
	}
	return s.doCPAAction(req, setup.ManagementKey)
}

func (s *Service) patchAuthFile(ctx context.Context, setup store.Setup, path string, payload map[string]any) (error, int) {
	data, err := json.Marshal(payload)
	if err != nil {
		return err, 0
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPatch,
		cpa.NormalizeBaseURL(setup.CPAUpstreamURL)+path,
		bytes.NewReader(data),
	)
	if err != nil {
		return err, 0
	}
	req.Header.Set("Content-Type", "application/json")
	return s.doCPAAction(req, setup.ManagementKey)
}

func (s *Service) doCPAAction(req *http.Request, managementKey string) (error, int) {
	req.Header.Set("Authorization", "Bearer "+managementKey)
	res, err := s.client.Do(req)
	if err != nil {
		return err, 0
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, maxStoredBodyText))
		return fmt.Errorf("%s %s", res.Status, truncate(string(body), maxStoredBodyText)), res.StatusCode
	}
	if err := cpaauthfiles.ValidateActionResponse(res.Body); err != nil {
		return err, res.StatusCode
	}
	return nil, res.StatusCode
}

type runLogger struct {
	service *Service
	runID   int64
}

func (l runLogger) info(ctx context.Context, message string, detail any) {
	l.log(ctx, "info", message, detail)
}

func (l runLogger) success(ctx context.Context, message string, detail any) {
	l.log(ctx, "success", message, detail)
}

func (l runLogger) warning(ctx context.Context, message string, detail any) {
	l.log(ctx, "warning", message, detail)
}

func (l runLogger) error(ctx context.Context, message string, detail any) {
	l.log(ctx, "error", message, detail)
}

func (l runLogger) log(ctx context.Context, level string, message string, detail any) {
	if l.service == nil || l.runID <= 0 {
		return
	}
	// Keep inspection log writes serialized, but do not let a blocked SQLite
	// writer make every probe wait behind it. Process logs are best-effort; a
	// saturated gate drops the ordinary log and leaves lifecycle cleanup free
	// to continue.
	releaseGate := func() {}
	if l.service.logGate != nil {
		select {
		case l.service.logGate <- struct{}{}:
			releaseGate = func() { <-l.service.logGate }
		case <-time.After(processLogQueueWait):
			log.Printf("drop codex inspection log run %d: SQLite log writer is busy", l.runID)
			return
		}
	} else {
		l.service.logMu.Lock()
		releaseGate = l.service.logMu.Unlock
	}
	defer releaseGate()
	// Keep the write independent from a cancelled probe context and bounded so
	// a transient database lock cannot stall the inspection indefinitely.
	if ctx == nil {
		ctx = context.Background()
	}
	logCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), processLogWriteTimeout)
	defer cancel()
	if _, err := l.service.store.InsertCodexInspectionLog(logCtx, model.CodexInspectionLog{
		RunID:   l.runID,
		Level:   level,
		Message: message,
		Detail:  sanitizeDetail(detail),
	}); err != nil {
		log.Printf("write codex inspection log run %d: %v", l.runID, err)
	}
}

func resolveProbeAction(item account, statusCode int, bodyText string, rateLimit *codexRateLimit, usedPercent *float64, isQuota bool, threshold float64, planTypes ...string) inspectionDecision {
	if isDeactivatedWorkspaceResponse(statusCode, bodyText) {
		return resolveDeactivatedWorkspaceProbeAction(usedPercent)
	}
	planType := ""
	if len(planTypes) > 0 {
		planType = planTypes[0]
	}
	if decision := resolveWindowAwareProbeAction(item, statusCode, bodyText, rateLimit, threshold, planType); decision != nil {
		return *decision
	}
	return resolveLegacyProbeAction(item, statusCode, bodyText, usedPercent, isQuota, threshold)
}

func isDeactivatedWorkspaceResponse(statusCode int, bodyText string) bool {
	return statusCode == http.StatusPaymentRequired &&
		strings.Contains(strings.ToLower(bodyText), "deactivated_workspace")
}

func resolveDeactivatedWorkspaceProbeAction(usedPercent *float64) inspectionDecision {
	return inspectionDecision{
		Action:       "delete",
		ActionReason: "接口返回 402，工作区已停用，建议删除账号",
		UsedPercent:  usedPercent,
		IsQuota:      false,
	}
}

func resolveWindowAwareProbeAction(item account, statusCode int, bodyText string, rateLimit *codexRateLimit, threshold float64, planType string) *inspectionDecision {
	if rateLimit == nil {
		return nil
	}
	classified := classifyWindows(rateLimit, planType)
	longWindow := classified.longWindow()
	if longWindow == nil || longWindow.UsedPercent == nil {
		decision := inspectionDecision{
			Action:       "keep",
			ActionReason: "额度信息不完整，保留账号",
			UsedPercent:  deriveRateLimitUsedPercent(rateLimit),
			IsQuota:      false,
		}
		return &decision
	}
	longWindowUsedPercent := *longWindow.UsedPercent
	longWindowLabel := classified.longWindowLabel(longWindow)
	fiveHour := classified.FiveHour
	fiveHourOverThreshold := fiveHour != nil && fiveHour.UsedPercent != nil && *fiveHour.UsedPercent >= threshold

	if statusCode == http.StatusUnauthorized {
		decision := resolveUnauthorizedProbeAction(bodyText, ptrFloat(longWindowUsedPercent))
		return &decision
	}
	if longWindowUsedPercent >= threshold {
		if item.Disabled {
			return &inspectionDecision{
				Action:       "keep",
				ActionReason: fmt.Sprintf("%s达到阈值，但账号已禁用", longWindowLabel),
				UsedPercent:  ptrFloat(longWindowUsedPercent),
				IsQuota:      true,
			}
		}
		return &inspectionDecision{
			Action:       "disable",
			ActionReason: fmt.Sprintf("%s达到阈值，建议禁用账号", longWindowLabel),
			UsedPercent:  ptrFloat(longWindowUsedPercent),
			IsQuota:      true,
		}
	}
	if item.Disabled {
		if fiveHourOverThreshold {
			return &inspectionDecision{
				Action:       "keep",
				ActionReason: fmt.Sprintf("5 小时额度仍达到阈值，%s可用但继续保持禁用", longWindowLabel),
				UsedPercent:  ptrFloat(longWindowUsedPercent),
				IsQuota:      true,
			}
		}
		reason := fmt.Sprintf("%s仍可用，建议立即启用账号", longWindowLabel)
		return &inspectionDecision{
			Action:       "enable",
			ActionReason: reason,
			UsedPercent:  ptrFloat(longWindowUsedPercent),
			IsQuota:      false,
		}
	}
	if fiveHourOverThreshold {
		return &inspectionDecision{
			Action:       "keep",
			ActionReason: fmt.Sprintf("5 小时额度达到阈值，但%s仍可用，暂不禁用账号", longWindowLabel),
			UsedPercent:  ptrFloat(longWindowUsedPercent),
			IsQuota:      false,
		}
	}
	return &inspectionDecision{
		Action:       "keep",
		ActionReason: fmt.Sprintf("%s仍可用，无需处理", longWindowLabel),
		UsedPercent:  ptrFloat(longWindowUsedPercent),
		IsQuota:      false,
	}
}

func resolveLegacyProbeAction(item account, statusCode int, bodyText string, usedPercent *float64, isQuota bool, threshold float64) inspectionDecision {
	overThreshold := usedPercent != nil && *usedPercent >= threshold
	if statusCode == http.StatusUnauthorized {
		return resolveUnauthorizedProbeAction(bodyText, usedPercent)
	}
	if isQuota || overThreshold {
		if item.Disabled {
			reason := "额度已耗尽，但账号已禁用"
			if overThreshold {
				reason = "额度超阈值，但账号已禁用"
			}
			return inspectionDecision{Action: "keep", ActionReason: reason, UsedPercent: usedPercent, IsQuota: isQuota}
		}
		reason := "额度已耗尽，建议禁用账号"
		if overThreshold {
			reason = "额度超阈值，建议禁用账号"
		}
		return inspectionDecision{Action: "disable", ActionReason: reason, UsedPercent: usedPercent, IsQuota: isQuota}
	}
	if statusCode == http.StatusOK && item.Disabled && usedPercent != nil {
		return inspectionDecision{
			Action:       "enable",
			ActionReason: "账号恢复健康，建议重新启用",
			UsedPercent:  usedPercent,
			IsQuota:      false,
		}
	}
	if statusCode == http.StatusOK && item.Disabled {
		return inspectionDecision{
			Action:       "keep",
			ActionReason: "额度信息不完整，无法确认恢复，保留账号",
			UsedPercent:  usedPercent,
			IsQuota:      false,
		}
	}
	return inspectionDecision{Action: "keep", ActionReason: "无需处理", UsedPercent: usedPercent, IsQuota: false}
}

func resolveUnauthorizedProbeAction(bodyText string, usedPercent *float64) inspectionDecision {
	decision, ok := credentialpolicy.EvaluateFailure(credentialpolicy.FailureSignal{
		Provider:   "codex",
		StatusCode: http.StatusUnauthorized,
		Summary:    bodyText,
	})
	if !ok {
		return inspectionDecision{
			Action:       "reauth",
			ActionReason: "接口返回 401，认证失败，建议重新登录账号",
			UsedPercent:  usedPercent,
			IsQuota:      false,
		}
	}
	switch decision.ReasonCode {
	case credentialpolicy.ReasonInvalidCredentials:
		return inspectionDecision{
			Action:       "reauth",
			ActionReason: "接口返回 401，登录已过期，建议重新登录账号",
			UsedPercent:  usedPercent,
			IsQuota:      false,
		}
	case credentialpolicy.ReasonTokenRevoked:
		return inspectionDecision{
			Action:       "reauth",
			ActionReason: "接口返回 401，认证令牌已失效，建议重新登录账号",
			UsedPercent:  usedPercent,
			IsQuota:      false,
		}
	default:
		return inspectionDecision{
			Action:       "reauth",
			ActionReason: "接口返回 401，认证失败，建议重新登录账号",
			UsedPercent:  usedPercent,
			IsQuota:      false,
		}
	}
}

func resolveAutoActionResults(mode string, results []model.CodexInspectionResult) []model.CodexInspectionResult {
	mode = model.NormalizeCodexInspectionAutoActionMode(mode, model.CodexInspectionAutoActionNone)
	if mode == model.CodexInspectionAutoActionNone {
		return results
	}
	out := make([]model.CodexInspectionResult, len(results))
	copy(out, results)
	return out
}

func resolveExecutableAction(mode string, action string) string {
	if mode == model.CodexInspectionAutoActionDisable && action == "delete" {
		return "disable"
	}
	return action
}

func selectAutoActionItems(mode string, autoRecoverEnabled bool, results []model.CodexInspectionResult) ([]model.CodexInspectionResult, []ActionOutcome) {
	mode = model.NormalizeCodexInspectionAutoActionMode(mode, model.CodexInspectionAutoActionNone)
	if mode == model.CodexInspectionAutoActionNone && !autoRecoverEnabled {
		return nil, nil
	}

	items := make([]model.CodexInspectionResult, 0)
	outcomes := make([]ActionOutcome, 0)
	for _, group := range buildExecutableFileActionGroups(results) {
		if group.Mixed {
			for _, result := range group.Items {
				outcomes = append(outcomes, needsReviewActionOutcome(result, result.Action, fileActionMixedReason))
			}
			continue
		}
		if len(group.Items) == 0 || !allowAutoAction(mode, autoRecoverEnabled, group.Items[0]) {
			continue
		}
		items = append(items, group.Items[0])
		for _, result := range group.Items[1:] {
			outcomes = append(outcomes, skippedActionOutcome(result, result.Action, fileActionDuplicateReason))
		}
	}
	return items, outcomes
}

func buildExecutableFileActionGroups(results []model.CodexInspectionResult) []fileActionGroup {
	groupOrder := make([]string, 0)
	groupsByFileName := map[string]*fileActionGroup{}
	for _, result := range results {
		if !isExecutableInspectionAction(result.Action) {
			continue
		}
		fileName := strings.TrimSpace(result.FileName)
		if fileName == "" {
			continue
		}
		group, ok := groupsByFileName[fileName]
		if !ok {
			group = &fileActionGroup{FileName: fileName, Action: result.Action}
			groupsByFileName[fileName] = group
			groupOrder = append(groupOrder, fileName)
		}
		if result.Action != group.Action {
			group.Mixed = true
		}
		group.Items = append(group.Items, result)
	}
	groups := make([]fileActionGroup, 0, len(groupOrder))
	for _, fileName := range groupOrder {
		groups = append(groups, *groupsByFileName[fileName])
	}
	return groups
}

func allowAutoAction(mode string, autoRecoverEnabled bool, result model.CodexInspectionResult) bool {
	if result.Action == "enable" {
		return autoRecoverEnabled && result.AutoRecoverEligible
	}
	switch mode {
	case model.CodexInspectionAutoActionEnable:
		return false
	case model.CodexInspectionAutoActionDisable:
		return result.Action == "disable" || result.Action == "delete"
	case model.CodexInspectionAutoActionDelete:
		return result.Action == "disable" || result.Action == "delete"
	default:
		return false
	}
}

func (s *Service) applyDisableOwnership(ctx context.Context, accounts []account, logger runLogger) {
	items, err := s.store.ListCodexInspectionDisableOwnership(ctx)
	if err != nil {
		logger.warning(ctx, "加载巡检禁用所有权失败，自动恢复将保持关闭", map[string]any{"error": err.Error()})
		return
	}
	for _, item := range items {
		provider := normalizeInspectionProvider(item.Provider)
		if provider == "" {
			provider = "codex"
		}
		matched := false
		disabled := false
		for _, candidate := range accounts {
			if candidate.FileName != item.FileName {
				continue
			}
			if normalizeInspectionProvider(candidate.Provider) != provider {
				continue
			}
			if item.AuthIndex != "" && candidate.AuthIndex != item.AuthIndex {
				continue
			}
			if item.AccountID != "" && candidate.AccountID != item.AccountID {
				continue
			}
			matched = true
			disabled = disabled || candidate.Disabled
		}
		if !matched || !disabled {
			if err := s.store.DeleteCodexInspectionDisableOwnership(ctx, item.FileName); err != nil {
				logger.warning(ctx, "清理巡检禁用所有权失败", map[string]any{
					"fileName": item.FileName,
					"error":    err.Error(),
				})
			}
			continue
		}
		for index := range accounts {
			if accounts[index].FileName == item.FileName && normalizeInspectionProvider(accounts[index].Provider) == provider {
				accounts[index].AutoRecoverOwned = true
			}
		}
	}
}

func selectManualActionItems(
	results []model.CodexInspectionResult,
	selected map[int64]struct{},
) ([]model.CodexInspectionResult, []ActionOutcome) {
	items := make([]model.CodexInspectionResult, 0, len(selected))
	outcomes := make([]ActionOutcome, 0)
	seenFileNames := map[string]struct{}{}
	groupByFileName := map[string]fileActionGroup{}
	for _, group := range buildExecutableFileActionGroups(results) {
		groupByFileName[group.FileName] = group
	}
	for _, result := range results {
		if _, ok := selected[result.ID]; !ok {
			continue
		}
		fileName := strings.TrimSpace(result.FileName)
		if !isExecutableInspectionAction(result.Action) {
			outcomes = append(outcomes, skippedActionOutcome(result, result.Action, "该巡检结果不是可执行动作"))
			continue
		}
		switch model.NormalizeCodexInspectionActionStatus(result.ActionStatus, result.Action) {
		case model.CodexInspectionActionStatusSuccess:
			outcomes = append(outcomes, skippedActionOutcome(result, result.Action, "该建议动作已执行成功"))
			continue
		case model.CodexInspectionActionStatusSkipped:
			outcomes = append(outcomes, skippedActionOutcome(result, result.Action, "该建议动作已跳过"))
			continue
		case model.CodexInspectionActionStatusNeedsReview:
			outcomes = append(outcomes, needsReviewActionOutcome(result, result.Action, "该建议动作需要到认证文件管理中人工处理"))
			continue
		}
		if fileName == "" {
			outcomes = append(outcomes, failedActionOutcome(result, result.Action, "认证文件名为空，无法执行"))
			continue
		}
		group, ok := groupByFileName[fileName]
		if ok && group.Mixed {
			outcomes = append(outcomes, needsReviewActionOutcome(result, result.Action, fileActionMixedReason))
			continue
		}
		if ok && len(group.Items) > 0 && group.Items[0].ID != result.ID {
			outcomes = append(outcomes, skippedActionOutcome(result, result.Action, "CPA 认证文件动作按文件执行，该文件已有另一条结果作为可执行项"))
			continue
		}
		if _, ok := seenFileNames[fileName]; ok {
			outcomes = append(outcomes, skippedActionOutcome(result, result.Action, "CPA 认证文件动作按文件执行，同名文件已由另一条结果处理"))
			continue
		}
		seenFileNames[fileName] = struct{}{}
		items = append(items, result)
	}
	return items, outcomes
}

func isExecutableInspectionAction(action string) bool {
	return action == "delete" || action == "disable" || action == "enable"
}

func (s *Service) validateActionItems(
	ctx context.Context,
	logCtx context.Context,
	setup store.Setup,
	items []model.CodexInspectionResult,
	logger runLogger,
	logPrefix string,
	actionFor func(model.CodexInspectionResult) string,
) ([]model.CodexInspectionResult, []ActionOutcome, error) {
	if len(items) == 0 {
		return nil, nil, nil
	}
	files, err := s.fetchAuthFiles(ctx, setup)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, nil, ctxErr
		}
		message := fmt.Sprintf("刷新认证文件失败，已拒绝执行：%v", err)
		outcomes := make([]ActionOutcome, 0, len(items))
		for _, item := range items {
			action := item.Action
			if actionFor != nil {
				action = actionFor(item)
			}
			outcome := failedActionOutcome(item, action, message)
			outcomes = append(outcomes, outcome)
			logger.error(logCtx, logPrefix+"账号校验失败", map[string]any{
				"fileName":       item.FileName,
				"displayAccount": item.DisplayAccount,
				"action":         action,
				"authIndex":      item.AuthIndex,
				"accountId":      item.AccountID,
				"error":          outcome.Error,
			})
		}
		return nil, outcomes, nil
	}
	currentByFile := map[string][]account{}
	for _, file := range files {
		item := toAccount(file)
		currentByFile[item.FileName] = append(currentByFile[item.FileName], item)
	}

	validItems := make([]model.CodexInspectionResult, 0, len(items))
	outcomes := make([]ActionOutcome, 0)
	for _, item := range items {
		action := item.Action
		if actionFor != nil {
			action = actionFor(item)
		}
		current, ok := matchCurrentAccount(currentByFile[item.FileName], item)
		if !ok {
			outcome := failedActionOutcome(item, action, "认证文件不存在或账号标识已变化，已拒绝执行")
			outcomes = append(outcomes, outcome)
			logger.error(logCtx, logPrefix+"账号校验失败", map[string]any{
				"fileName":       item.FileName,
				"displayAccount": item.DisplayAccount,
				"action":         action,
				"authIndex":      item.AuthIndex,
				"accountId":      item.AccountID,
				"error":          outcome.Error,
			})
			continue
		}
		item.Disabled = current.Disabled
		if action == "disable" && current.Disabled {
			outcome := skippedActionOutcome(item, action, "账号已是禁用状态，未重复执行")
			outcome.CurrentDisabled = boolPointer(current.Disabled)
			outcomes = append(outcomes, outcome)
			logger.info(logCtx, logPrefix+"账号跳过", map[string]any{
				"fileName":       item.FileName,
				"displayAccount": item.DisplayAccount,
				"action":         action,
				"reason":         outcome.Error,
			})
			continue
		}
		if action == "enable" && !current.Disabled {
			outcome := skippedActionOutcome(item, action, "账号已是启用状态，未重复执行")
			outcome.CurrentDisabled = boolPointer(current.Disabled)
			outcomes = append(outcomes, outcome)
			logger.info(logCtx, logPrefix+"账号跳过", map[string]any{
				"fileName":       item.FileName,
				"displayAccount": item.DisplayAccount,
				"action":         action,
				"reason":         outcome.Error,
			})
			continue
		}
		validItems = append(validItems, item)
	}
	return validItems, outcomes, nil
}

func matchCurrentAccount(candidates []account, result model.CodexInspectionResult) (account, bool) {
	if len(candidates) == 0 {
		return account{}, false
	}
	authIndex := strings.TrimSpace(result.AuthIndex)
	accountID := strings.TrimSpace(result.AccountID)
	provider := normalizeInspectionProvider(result.Provider)
	if provider == "" {
		provider = "codex"
	}
	if authIndex == "" && accountID == "" {
		for _, candidate := range candidates {
			if normalizeInspectionProvider(candidate.Provider) == provider {
				return candidate, true
			}
		}
		return account{}, false
	}
	for _, candidate := range candidates {
		if normalizeInspectionProvider(candidate.Provider) != provider {
			continue
		}
		if authIndex != "" && candidate.AuthIndex != authIndex {
			continue
		}
		if accountID != "" && candidate.AccountID != accountID {
			continue
		}
		return candidate, true
	}
	return account{}, false
}

func summarizeRun(run model.CodexInspectionRun, results []model.CodexInspectionResult) model.CodexInspectionRun {
	run.DisabledCount = 0
	run.EnabledCount = 0
	run.DeleteCount = 0
	run.DisableCount = 0
	run.EnableCount = 0
	run.ReauthCount = 0
	run.KeepCount = 0
	for _, result := range results {
		if result.Disabled {
			run.DisabledCount++
		} else {
			run.EnabledCount++
		}
		switch result.Action {
		case "delete":
			run.DeleteCount++
		case "disable":
			run.DisableCount++
		case "enable":
			run.EnableCount++
		case "reauth":
			run.ReauthCount++
		default:
			run.KeepCount++
		}
	}
	return run
}

func applyActionOutcomes(results []model.CodexInspectionResult, outcomes []ActionOutcome) []model.CodexInspectionResult {
	if len(outcomes) == 0 {
		return results
	}
	byKey := map[string]ActionOutcome{}
	for _, outcome := range outcomes {
		byKey[outcome.AccountKey] = outcome
	}
	out := make([]model.CodexInspectionResult, len(results))
	copy(out, results)
	for i := range out {
		outcome, ok := byKey[out[i].AccountKey]
		if !ok {
			continue
		}
		if outcome.CurrentDisabled != nil {
			out[i].Disabled = *outcome.CurrentDisabled
		}
		status := model.NormalizeCodexInspectionActionStatus(outcome.Status, out[i].Action)
		currentStatus := model.NormalizeCodexInspectionActionStatus(out[i].ActionStatus, out[i].Action)
		if currentStatus == model.CodexInspectionActionStatusSuccess && status == model.CodexInspectionActionStatusSkipped {
			continue
		}
		if status == model.CodexInspectionActionStatusPending {
			if outcome.Success {
				status = model.CodexInspectionActionStatusSuccess
			} else {
				status = model.CodexInspectionActionStatusFailed
			}
		}
		out[i].ActionStatus = status
		out[i].ActionError = outcome.Error
		out[i].ExecutedAction = ""
		if status == model.CodexInspectionActionStatusSuccess {
			out[i].ExecutedAction = outcome.Action
			out[i].ActionError = ""
			switch outcome.Action {
			case "disable":
				out[i].Disabled = true
			case "enable":
				out[i].Disabled = false
			}
		}
	}
	return out
}

func failedActionOutcome(item model.CodexInspectionResult, action string, message string) ActionOutcome {
	return ActionOutcome{
		ResultID:       item.ID,
		AccountKey:     item.AccountKey,
		FileName:       item.FileName,
		DisplayAccount: item.DisplayAccount,
		Action:         action,
		Status:         model.CodexInspectionActionStatusFailed,
		Success:        false,
		Error:          message,
	}
}

func needsReviewActionOutcome(item model.CodexInspectionResult, action string, message string) ActionOutcome {
	return ActionOutcome{
		ResultID:       item.ID,
		AccountKey:     item.AccountKey,
		FileName:       item.FileName,
		DisplayAccount: item.DisplayAccount,
		Action:         action,
		Status:         model.CodexInspectionActionStatusNeedsReview,
		Success:        true,
		Error:          message,
	}
}

func skippedActionOutcome(item model.CodexInspectionResult, action string, message string) ActionOutcome {
	return ActionOutcome{
		ResultID:       item.ID,
		AccountKey:     item.AccountKey,
		FileName:       item.FileName,
		DisplayAccount: item.DisplayAccount,
		Action:         action,
		Status:         model.CodexInspectionActionStatusSkipped,
		Success:        true,
		Error:          message,
	}
}

type actionOutcomeSummary struct {
	Success     int
	Failed      int
	Skipped     int
	NeedsReview int
}

func summarizeActionOutcomes(outcomes []ActionOutcome) actionOutcomeSummary {
	summary := actionOutcomeSummary{}
	for _, outcome := range outcomes {
		switch outcome.Status {
		case model.CodexInspectionActionStatusSuccess:
			summary.Success++
		case model.CodexInspectionActionStatusFailed:
			summary.Failed++
		case model.CodexInspectionActionStatusSkipped:
			summary.Skipped++
		case model.CodexInspectionActionStatusNeedsReview:
			summary.NeedsReview++
		default:
			if outcome.Success {
				summary.Success++
			} else {
				summary.Failed++
			}
		}
	}
	return summary
}

func logPreflightActionOutcomes(
	ctx context.Context,
	logger runLogger,
	prefix string,
	outcomes []ActionOutcome,
) {
	for _, outcome := range outcomes {
		level := "info"
		message := prefix + "账号跳过"
		if outcome.Status == model.CodexInspectionActionStatusNeedsReview {
			level = "warning"
		}
		if outcome.Status == model.CodexInspectionActionStatusFailed || !outcome.Success {
			level = "error"
			message = prefix + "账号失败"
		}
		logger.log(ctx, level, message, map[string]any{
			"fileName":       outcome.FileName,
			"displayAccount": outcome.DisplayAccount,
			"action":         outcome.Action,
			"status":         outcome.Status,
			"reason":         outcome.Error,
		})
	}
}

func (s *Service) persistInspectionResults(
	ctx context.Context,
	runID int64,
	results []model.CodexInspectionResult,
	logger runLogger,
) int {
	// Probe workers only perform network work. Persist their results serially
	// here so each account is written once per lifecycle phase and SQLite does
	// not receive a burst of concurrent upserts.
	if ctx == nil {
		ctx = context.Background()
	}
	// A cancelled inspection may have a large partial result set. Keep its final
	// lifecycle transition bounded, but never impose a fixed whole-batch budget
	// on a healthy run: large successful inspections must persist every result.
	startedCancelled := ctx.Err() != nil
	persistCtx := context.WithoutCancel(ctx)
	persistCancel := func() {}
	if startedCancelled {
		persistCtx, persistCancel = context.WithTimeout(persistCtx, cancelledPersistTimeout)
	}
	defer persistCancel()
	failures := 0
	for index, result := range results {
		if !startedCancelled && ctx.Err() != nil {
			remaining := len(results) - index
			failures += remaining
			logger.error(ctx, "巡检取消后停止写入剩余账号结果", map[string]any{
				"remainingCount": remaining,
				"error":          ctx.Err().Error(),
			})
			break
		}
		if err := persistCtx.Err(); err != nil {
			remaining := len(results) - index
			failures += remaining
			logger.error(ctx, "巡检结果持久化时间预算已耗尽", map[string]any{
				"remainingCount": remaining,
				"error":          err.Error(),
			})
			break
		}
		result.RunID = runID
		writeCtx, cancel := context.WithTimeout(persistCtx, resultWriteTimeout)
		_, err := s.store.InsertCodexInspectionResult(writeCtx, result)
		cancel()
		if err != nil {
			failures++
			logger.error(ctx, "写入巡检账号结果失败", map[string]any{
				"fileName":       result.FileName,
				"displayAccount": result.DisplayAccount,
				"retryScheduled": true,
				"error":          err.Error(),
			})
		}
	}
	return failures
}

func (s *Service) getRunWithResultFallback(
	ctx context.Context,
	runID int64,
	latestResults []model.CodexInspectionResult,
	useFallback bool,
) (RunDetail, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	// Callers already detach request cancellation where lifecycle persistence
	// must continue. Preserve any shorter caller deadline so cancellation and
	// shutdown paths cannot accidentally receive a fresh full read budget here.
	readCtx, cancelRead := context.WithTimeout(ctx, criticalWriteTimeout)
	defer cancelRead()
	detail, err := s.GetRun(readCtx, runID)
	if err != nil || !useFallback {
		return detail, err
	}
	detail.Results = overlayInspectionResultSnapshots(runID, detail.Results, latestResults)
	return detail, nil
}

func overlayInspectionResultSnapshots(
	runID int64,
	persisted []model.CodexInspectionResult,
	latest []model.CodexInspectionResult,
) []model.CodexInspectionResult {
	persistedByAccount := make(map[string]model.CodexInspectionResult, len(persisted))
	for _, result := range persisted {
		persistedByAccount[result.AccountKey] = result
	}

	overlaid := make([]model.CodexInspectionResult, len(latest))
	for index, result := range latest {
		result.RunID = runID
		result.ActionStatus = model.NormalizeCodexInspectionActionStatus(result.ActionStatus, result.Action)
		if stored, ok := persistedByAccount[result.AccountKey]; ok {
			if result.ID <= 0 {
				result.ID = stored.ID
			}
			if result.CreatedAtMS <= 0 {
				result.CreatedAtMS = stored.CreatedAtMS
			}
		}
		overlaid[index] = result
	}
	return overlaid
}

func failedActionOutcomes(outcomes []ActionOutcome) []map[string]any {
	failed := make([]map[string]any, 0)
	for _, outcome := range outcomes {
		if outcome.Success {
			continue
		}
		failed = append(failed, map[string]any{
			"fileName":       outcome.FileName,
			"displayAccount": outcome.DisplayAccount,
			"action":         outcome.Action,
			"error":          outcome.Error,
		})
	}
	return failed
}

func resultFromAccount(item account) model.CodexInspectionResult {
	return model.CodexInspectionResult{
		AccountKey:     item.Key,
		FileName:       item.FileName,
		DisplayAccount: item.DisplayAccount,
		AuthIndex:      item.AuthIndex,
		AccountID:      item.AccountID,
		Provider:       item.Provider,
		Disabled:       item.Disabled,
		Status:         item.Status,
		State:          item.State,
		PlanType:       resolveCodexPlanType(item.File),
		Action:         "keep",
		ActionReason:   "无需处理",
		IsQuota:        false,
	}
}

func pickSample(items []account, sampleSize int) []account {
	if sampleSize <= 0 || sampleSize >= len(items) {
		out := make([]account, len(items))
		copy(out, items)
		return out
	}
	out := make([]account, len(items))
	copy(out, items)
	rand.Shuffle(len(out), func(i, j int) {
		out[i], out[j] = out[j], out[i]
	})
	return out[:sampleSize]
}

// pickSamplePerProvider applies the configured sample size independently to
// each selected provider. This prevents a combined Codex+xAI run from randomly
// sampling only one provider and leaving the other without health evidence.
func pickSamplePerProvider(items []account, sampleSize int) []account {
	if sampleSize <= 0 {
		out := make([]account, len(items))
		copy(out, items)
		return out
	}

	groups := make(map[string][]account)
	providerOrder := make([]string, 0)
	for _, item := range items {
		if _, ok := groups[item.Provider]; !ok {
			providerOrder = append(providerOrder, item.Provider)
		}
		groups[item.Provider] = append(groups[item.Provider], item)
	}

	result := make([]account, 0, len(items))
	for _, provider := range providerOrder {
		result = append(result, pickSample(groups[provider], sampleSize)...)
	}
	return result
}

func countAccounts(items []account, disabled bool) int {
	count := 0
	for _, item := range items {
		if item.Disabled == disabled {
			count++
		}
	}
	return count
}

func toAccount(file authFile) account {
	fileName := firstNonEmpty(readString(file, "name"), readString(file, "id"), normalizeAuthIndex(file["auth_index"]), normalizeAuthIndex(file["authIndex"]), "unknown-auth-file")
	authIndex := firstNonEmpty(normalizeAuthIndex(file["auth_index"]), normalizeAuthIndex(file["authIndex"]), normalizeAuthIndex(file["auth-index"]))
	provider := normalizeInspectionProvider(firstNonEmpty(readString(file, "provider"), readString(file, "type")))
	displayAccount := firstNonEmpty(
		readString(file, "account"),
		readString(file, "email"),
		readString(file, "label"),
		fileName,
	)
	key := fileName + "::" + authIndex
	if authIndex == "" {
		key = fileName + "::-"
	}
	return account{
		Key:            key,
		FileName:       fileName,
		DisplayAccount: displayAccount,
		AuthIndex:      authIndex,
		AccountID:      resolveCodexAccountID(file),
		Provider:       provider,
		Disabled:       isDisabledAuthFile(file),
		Status:         readString(file, "status"),
		State:          readString(file, "state"),
		File:           file,
	}
}

func normalizeInspectionProvider(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	switch normalized {
	case "x-ai", "grok":
		return "xai"
	default:
		return normalized
	}
}

func resolveCodexAccountID(file authFile) string {
	metadata := readMap(file, "metadata")
	attributes := readMap(file, "attributes")
	candidates := []any{
		file["chatgpt_account_id"],
		file["chatgptAccountId"],
		file["account_id"],
		file["accountId"],
		metadata["chatgpt_account_id"],
		metadata["chatgptAccountId"],
		metadata["account_id"],
		metadata["accountId"],
		attributes["chatgpt_account_id"],
		attributes["chatgptAccountId"],
		attributes["account_id"],
		attributes["accountId"],
	}
	for _, candidate := range candidates {
		if id := extractDirectCodexAccountID(candidate); id != "" {
			return id
		}
	}
	tokenCandidates := []any{
		file["id_token"],
		metadata["id_token"],
		attributes["id_token"],
	}
	for _, candidate := range tokenCandidates {
		if id := extractCodexAccountIDFromToken(candidate); id != "" {
			return id
		}
	}
	return ""
}

func extractDirectCodexAccountID(value any) string {
	if direct := readPlainString(value); direct != "" {
		return direct
	}
	if direct := readAccountIDCandidate(value); direct != "" {
		return direct
	}
	return ""
}

func extractCodexAccountIDFromToken(value any) string {
	payload := parseIDTokenPayload(value)
	if payload == nil {
		return ""
	}
	return readAccountIDCandidate(payload)
}

func resolveCodexPlanType(file authFile) string {
	metadata := readMap(file, "metadata")
	attributes := readMap(file, "attributes")
	candidates := []any{
		file["plan_type"],
		file["planType"],
		extractCodexPlanTypeFromToken(file["id_token"]),
		readMap(file, "id_token"),
		metadata["plan_type"],
		metadata["planType"],
		extractCodexPlanTypeFromToken(metadata["id_token"]),
		readMap(metadata, "id_token"),
		attributes["plan_type"],
		attributes["planType"],
		extractCodexPlanTypeFromToken(attributes["id_token"]),
	}
	for _, candidate := range candidates {
		if planType := readCodexPlanTypeCandidate(candidate); planType != "" {
			return planType
		}
	}
	return ""
}

func extractCodexPlanTypeFromToken(value any) string {
	payload := parseIDTokenPayload(value)
	if payload == nil {
		return ""
	}
	return readCodexPlanTypeCandidate(payload)
}

func readCodexPlanTypeCandidate(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return normalizeCodexPlanType(typed)
	case map[string]any:
		return normalizeCodexPlanType(readString(typed, "plan_type", "planType"))
	default:
		return normalizeCodexPlanType(fmt.Sprint(value))
	}
}

func readPlainString(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func readAccountIDCandidate(value any) string {
	record, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	return firstNonEmpty(
		readString(record, "chatgpt_account_id"),
		readString(record, "chatgptAccountId"),
		readString(record, "account_id"),
		readString(record, "accountId"),
	)
}

func parseIDTokenPayload(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			return parsed
		}
		segments := strings.Split(trimmed, ".")
		if len(segments) < 2 {
			return nil
		}
		decoded, err := base64.RawURLEncoding.DecodeString(segments[1])
		if err != nil {
			decoded, err = base64.URLEncoding.DecodeString(padBase64(segments[1]))
			if err != nil {
				return nil
			}
		}
		if err := json.Unmarshal(decoded, &parsed); err == nil {
			return parsed
		}
	}
	return nil
}

func parseRateLimit(raw map[string]any) *codexRateLimit {
	if raw == nil {
		return nil
	}
	limit := &codexRateLimit{
		PrimaryWindow:   parseWindow(readMap(raw, "primary_window", "primaryWindow")),
		SecondaryWindow: parseWindow(readMap(raw, "secondary_window", "secondaryWindow")),
	}
	if value, ok := readBoolPtr(raw, "allowed"); ok {
		limit.Allowed = value
	}
	limit.LimitReached = readBool(raw, "limit_reached", "limitReached")
	return limit
}

func parseWindow(raw map[string]any) *codexWindow {
	if raw == nil {
		return nil
	}
	window := &codexWindow{}
	if value, ok := readNumberPtr(raw, "used_percent", "usedPercent"); ok {
		window.UsedPercent = value
	}
	if value, ok := readNumberPtr(raw, "limit_window_seconds", "limitWindowSeconds"); ok {
		window.LimitWindowSeconds = value
	}
	if value, ok := readNumberPtr(raw, "reset_after_seconds", "resetAfterSeconds"); ok {
		window.ResetAfterSeconds = value
	}
	if value, ok := readNumberPtr(raw, "reset_at", "resetAt"); ok {
		window.ResetAt = value
	}
	return window
}

func classifyWindows(limit *codexRateLimit, planType string) codexClassifiedWindows {
	if limit == nil {
		return codexClassifiedWindows{}
	}
	teamPlan := normalizeCodexPlanType(planType) == "team"
	raw := []*codexWindow{limit.PrimaryWindow, limit.SecondaryWindow}
	var fiveHour *codexWindow
	var weekly *codexWindow
	var monthly *codexWindow
	var genericLong *codexWindow
	for _, window := range raw {
		if window == nil || window.LimitWindowSeconds == nil {
			continue
		}
		seconds := int(math.Round(*window.LimitWindowSeconds))
		if seconds == codexFiveHourWindow && fiveHour == nil {
			fiveHour = window
		} else if seconds == codexWeekWindow && weekly == nil {
			weekly = window
		} else if (seconds == codexMonthWindow || isCodexMonthlyWindowSeconds(seconds)) && monthly == nil {
			monthly = window
		} else if seconds > codexFiveHourWindow && genericLong == nil {
			genericLong = window
		}
	}
	if fiveHour == nil && limit.PrimaryWindow != weekly && limit.PrimaryWindow != monthly && limit.PrimaryWindow != genericLong && !hasExplicitWindowSeconds(limit.PrimaryWindow) {
		fiveHour = limit.PrimaryWindow
	}
	if teamPlan {
		if monthly == nil && limit.SecondaryWindow != fiveHour && !hasExplicitWindowSeconds(limit.SecondaryWindow) {
			monthly = limit.SecondaryWindow
		}
	} else if weekly == nil && limit.SecondaryWindow != fiveHour && !hasExplicitWindowSeconds(limit.SecondaryWindow) {
		weekly = limit.SecondaryWindow
	}
	return codexClassifiedWindows{FiveHour: fiveHour, Weekly: weekly, Monthly: monthly, GenericLong: genericLong}
}

func isCodexMonthlyWindowSeconds(seconds int) bool {
	return seconds >= codexMinMonthWindow && seconds <= codexMaxMonthWindow
}

func buildCodexInspectionQuotaWindows(payload map[string]any, planType string) []model.CodexInspectionQuotaWindow {
	if payload == nil {
		return nil
	}
	teamPlan := normalizeCodexPlanType(firstNonEmpty(planType, readString(payload, "plan_type", "planType"))) == "team"
	windows := make([]model.CodexInspectionQuotaWindow, 0)
	addCodexRateLimitWindows(
		&windows,
		parseRateLimit(readMap(payload, "rate_limit", "rateLimit")),
		codexWindowMeta{ID: "five-hour", LabelKey: "codex_quota.primary_window"},
		codexWindowMeta{ID: "weekly", LabelKey: "codex_quota.secondary_window"},
		codexWindowMeta{ID: "monthly", LabelKey: "codex_quota.monthly_window"},
		"codex_quota.generic_window",
		nil,
		teamPlan,
	)
	addCodexRateLimitWindows(
		&windows,
		parseRateLimit(readMap(payload, "code_review_rate_limit", "codeReviewRateLimit")),
		codexWindowMeta{ID: "code-review-five-hour", LabelKey: "codex_quota.code_review_primary_window"},
		codexWindowMeta{ID: "code-review-weekly", LabelKey: "codex_quota.code_review_secondary_window"},
		codexWindowMeta{ID: "code-review-monthly", LabelKey: "codex_quota.code_review_monthly_window"},
		"codex_quota.code_review_generic_window",
		nil,
		teamPlan,
	)
	addAdditionalRateLimitWindows(&windows, readMapSlice(payload, "additional_rate_limits", "additionalRateLimits"), teamPlan)
	return windows
}

func addCodexRateLimitWindows(
	windows *[]model.CodexInspectionQuotaWindow,
	limit *codexRateLimit,
	fiveHourMeta codexWindowMeta,
	weeklyMeta codexWindowMeta,
	monthlyMeta codexWindowMeta,
	genericLabelKey string,
	genericLabelParams map[string]any,
	teamPlan bool,
) {
	if limit == nil {
		return
	}
	classified := classifyWindows(limit, codexPlanTypeForTeam(teamPlan))
	added := make(map[*codexWindow]bool)
	addCodexWindowInfo(windows, fiveHourMeta.ID, fiveHourMeta.LabelKey, genericLabelParams, classified.FiveHour, limit.LimitReached, limit.Allowed)
	if classified.FiveHour != nil {
		added[classified.FiveHour] = true
	}
	addCodexWindowInfo(windows, weeklyMeta.ID, weeklyMeta.LabelKey, genericLabelParams, classified.Weekly, limit.LimitReached, limit.Allowed)
	if classified.Weekly != nil {
		added[classified.Weekly] = true
	}
	addCodexWindowInfo(windows, monthlyMeta.ID, monthlyMeta.LabelKey, genericLabelParams, classified.Monthly, limit.LimitReached, limit.Allowed)
	if classified.Monthly != nil {
		added[classified.Monthly] = true
	}
	for index, window := range codexRateLimitWindows(limit) {
		if window == nil || added[window] {
			continue
		}
		duration := formatCodexWindowDuration(window.LimitWindowSeconds)
		prefix := ""
		if name, ok := genericLabelParams["name"]; ok {
			if normalizedName := normalizeCodexWindowID(fmt.Sprint(name)); normalizedName != "" {
				prefix = normalizedName + "-"
			}
		}
		addCodexWindowInfo(
			windows,
			fmt.Sprintf("%swindow-%s-%d", prefix, duration, index),
			genericLabelKey,
			withCodexWindowDurationParam(genericLabelParams, duration),
			window,
			limit.LimitReached,
			limit.Allowed,
		)
	}
}

func codexPlanTypeForTeam(teamPlan bool) string {
	if teamPlan {
		return "team"
	}
	return ""
}

func codexRateLimitWindows(limit *codexRateLimit) []*codexWindow {
	if limit == nil {
		return nil
	}
	return []*codexWindow{limit.PrimaryWindow, limit.SecondaryWindow}
}

func addCodexWindowInfo(
	windows *[]model.CodexInspectionQuotaWindow,
	id string,
	labelKey string,
	labelParams map[string]any,
	window *codexWindow,
	limitReached bool,
	allowed *bool,
) {
	if window == nil {
		return
	}
	resetLabel := formatCodexResetLabel(window)
	usedPercent := window.UsedPercent
	if usedPercent == nil && (limitReached || (allowed != nil && !*allowed)) && resetLabel != "-" {
		usedPercent = ptrFloat(100)
	}
	*windows = append(*windows, model.CodexInspectionQuotaWindow{
		ID:                 id,
		LabelKey:           labelKey,
		LabelParams:        copyCodexLabelParams(labelParams),
		UsedPercent:        usedPercent,
		ResetLabel:         resetLabel,
		LimitWindowSeconds: window.LimitWindowSeconds,
	})
}

func addAdditionalRateLimitWindows(windows *[]model.CodexInspectionQuotaWindow, additionalRateLimits []map[string]any, teamPlan bool) {
	for index, limitItem := range additionalRateLimits {
		rateInfo := parseRateLimit(readMap(limitItem, "rate_limit", "rateLimit"))
		if rateInfo == nil {
			continue
		}
		limitName := firstNonEmpty(
			readString(limitItem, "limit_name", "limitName"),
			readString(limitItem, "metered_feature", "meteredFeature"),
			fmt.Sprintf("additional-%d", index+1),
		)
		idPrefix := normalizeCodexWindowID(limitName)
		if idPrefix == "" {
			idPrefix = fmt.Sprintf("additional-%d", index+1)
		}
		addCodexRateLimitWindows(
			windows,
			rateInfo,
			codexWindowMeta{ID: fmt.Sprintf("%s-five-hour-%d", idPrefix, index), LabelKey: "codex_quota.additional_primary_window"},
			codexWindowMeta{ID: fmt.Sprintf("%s-weekly-%d", idPrefix, index), LabelKey: "codex_quota.additional_secondary_window"},
			codexWindowMeta{ID: fmt.Sprintf("%s-monthly-%d", idPrefix, index), LabelKey: "codex_quota.additional_monthly_window"},
			"codex_quota.additional_generic_window",
			map[string]any{"name": limitName},
			teamPlan,
		)
	}
}

func readMapSlice(record map[string]any, keys ...string) []map[string]any {
	value, ok := firstValue(record, keys...)
	if !ok || value == nil {
		return nil
	}
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if record, ok := item.(map[string]any); ok {
				items = append(items, record)
			}
		}
		return items
	}
	return nil
}

func formatCodexResetLabel(window *codexWindow) string {
	if window == nil {
		return "-"
	}
	if window.ResetAt != nil && *window.ResetAt > 0 {
		return formatUnixSeconds(*window.ResetAt)
	}
	if window.ResetAfterSeconds != nil && *window.ResetAfterSeconds > 0 {
		targetSeconds := float64(time.Now().Unix()) + math.Floor(*window.ResetAfterSeconds)
		return formatUnixSeconds(targetSeconds)
	}
	return "-"
}

func formatUnixSeconds(seconds float64) string {
	if seconds <= 0 {
		return "-"
	}
	unixSeconds := int64(math.Floor(seconds))
	if unixSeconds <= 0 {
		return "-"
	}
	return time.Unix(unixSeconds, 0).Local().Format("01/02 15:04")
}

func formatCodexWindowDuration(seconds *float64) string {
	if seconds == nil || *seconds <= 0 {
		return "unknown"
	}
	rounded := int(math.Round(*seconds))
	const daySeconds = 86_400
	const hourSeconds = 3_600
	if rounded%daySeconds == 0 {
		return fmt.Sprintf("%dd", rounded/daySeconds)
	}
	if rounded%hourSeconds == 0 {
		return fmt.Sprintf("%dh", rounded/hourSeconds)
	}
	return fmt.Sprintf("%ds", rounded)
}

func normalizeCodexWindowID(raw string) string {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return ""
	}
	var builder strings.Builder
	lastDash := false
	for _, char := range trimmed {
		isAlphaNumeric := (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
		if isAlphaNumeric {
			builder.WriteRune(char)
			lastDash = false
			continue
		}
		if !lastDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func copyCodexLabelParams(params map[string]any) map[string]any {
	if len(params) == 0 {
		return nil
	}
	out := make(map[string]any, len(params))
	for key, value := range params {
		out[key] = value
	}
	return out
}

func withCodexWindowDurationParam(params map[string]any, duration string) map[string]any {
	out := copyCodexLabelParams(params)
	if out == nil {
		out = map[string]any{}
	}
	out["duration"] = duration
	return out
}

func normalizeCodexPlanType(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	return normalized
}

func hasExplicitWindowSeconds(window *codexWindow) bool {
	return window != nil && window.LimitWindowSeconds != nil
}

func deriveRateLimitUsedPercent(limit *codexRateLimit) *float64 {
	if limit == nil {
		return nil
	}
	var values []float64
	for _, window := range []*codexWindow{limit.PrimaryWindow, limit.SecondaryWindow} {
		if window != nil && window.UsedPercent != nil {
			values = append(values, *window.UsedPercent)
		}
	}
	if len(values) == 0 {
		return nil
	}
	max := values[0]
	for _, value := range values[1:] {
		if value > max {
			max = value
		}
	}
	return &max
}

func isRateLimitReached(limit *codexRateLimit) bool {
	if limit == nil {
		return false
	}
	if limit.Allowed != nil && !*limit.Allowed {
		return true
	}
	if limit.LimitReached {
		return true
	}
	for _, window := range []*codexWindow{limit.PrimaryWindow, limit.SecondaryWindow} {
		if window != nil && window.UsedPercent != nil && *window.UsedPercent >= 100 {
			return true
		}
	}
	return false
}

func normalizeBody(input any) (string, any) {
	if input == nil {
		return "", nil
	}
	if text, ok := input.(string); ok {
		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			return text, nil
		}
		var parsed any
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			return text, parsed
		}
		return text, text
	}
	data, err := json.Marshal(input)
	if err != nil {
		return fmt.Sprint(input), input
	}
	return string(data), input
}

func parseRecord(input any) map[string]any {
	switch typed := input.(type) {
	case map[string]any:
		return typed
	case string:
		var parsed map[string]any
		if err := json.Unmarshal([]byte(strings.TrimSpace(typed)), &parsed); err == nil {
			return parsed
		}
	}
	return nil
}

func readMap(record map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		value, ok := record[key]
		if !ok || value == nil {
			continue
		}
		if typed, ok := value.(map[string]any); ok {
			return typed
		}
	}
	return nil
}

func firstValue(record map[string]any, keys ...string) (any, bool) {
	for _, key := range keys {
		value, ok := record[key]
		if ok {
			return value, true
		}
	}
	return nil, false
}

func readString(record map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := record[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" {
			return text
		}
	}
	return ""
}

func normalizeAuthIndex(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case float64:
		if math.Trunc(typed) == typed {
			return fmt.Sprintf("%.0f", typed)
		}
	case int:
		return fmt.Sprint(typed)
	case int64:
		return fmt.Sprint(typed)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func isDisabledAuthFile(file authFile) bool {
	status := strings.ToLower(firstNonEmpty(readString(file, "status"), readString(file, "state")))
	if status == "disabled" || status == "inactive" {
		return true
	}
	value, ok := file["disabled"]
	if !ok || value == nil {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case float64:
		return typed != 0
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		return normalized == "true" || normalized == "1"
	default:
		return false
	}
}

func readBool(record map[string]any, keys ...string) bool {
	for _, key := range keys {
		value, ok := record[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return typed
		case string:
			normalized := strings.ToLower(strings.TrimSpace(typed))
			return normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "on"
		case float64:
			return typed != 0
		}
	}
	return false
}

func readBoolPtr(record map[string]any, keys ...string) (*bool, bool) {
	for _, key := range keys {
		value, ok := record[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return &typed, true
		case string:
			normalized := strings.ToLower(strings.TrimSpace(typed))
			if normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "on" {
				result := true
				return &result, true
			}
			if normalized == "false" || normalized == "0" || normalized == "no" || normalized == "off" {
				result := false
				return &result, true
			}
		case float64:
			result := typed != 0
			return &result, true
		}
	}
	return nil, false
}

func readNumberPtr(record map[string]any, keys ...string) (*float64, bool) {
	for _, key := range keys {
		value, ok := record[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return &typed, true
		case int:
			value := float64(typed)
			return &value, true
		case string:
			parsed, err := strconvParseFloat(typed)
			if err == nil {
				return &parsed, true
			}
		}
	}
	return nil, false
}

func readFloat(value any, fallback float64) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case int:
		return float64(typed)
	case string:
		if parsed, err := strconvParseFloat(typed); err == nil {
			return parsed
		}
	}
	return fallback
}

func strconvParseFloat(value string) (float64, error) {
	return strconvParseFloat64(strings.TrimSpace(strings.TrimSuffix(value, "%")))
}

func strconvParseFloat64(value string) (float64, error) {
	var parsed float64
	_, err := fmt.Sscan(value, &parsed)
	return parsed, err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func ptrFloat(value float64) *float64 {
	return &value
}

func boolPointer(value bool) *bool {
	return &value
}

func nullableFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func truncate(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit] + "...(truncated)"
}

func sanitizeDetail(detail any) any {
	if detail == nil {
		return nil
	}
	data, err := json.Marshal(detail)
	if err != nil {
		return detail
	}
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return detail
	}
	return redactValue(parsed)
}

func redactValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			if isSecretKey(key) {
				result[key] = "[redacted]"
				continue
			}
			result[key] = redactValue(item)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for i, item := range typed {
			result[i] = redactValue(item)
		}
		return result
	default:
		return typed
	}
}

func isSecretKey(key string) bool {
	normalized := strings.ToLower(key)
	if normalized == "triggerkey" {
		return false
	}
	return strings.Contains(normalized, "token") ||
		strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "authorization") ||
		strings.Contains(normalized, "key")
}

func padBase64(value string) string {
	switch len(value) % 4 {
	case 2:
		return value + "=="
	case 3:
		return value + "="
	default:
		return value
	}
}
