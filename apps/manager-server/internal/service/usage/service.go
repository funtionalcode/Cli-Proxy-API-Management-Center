package usage

import (
	"context"
	"fmt"
	"io"
	"sync"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
	usageparser "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/usage"
)

type ImportResult struct {
	Format      string   `json:"format"`
	Added       int      `json:"added"`
	Skipped     int      `json:"skipped"`
	Total       int      `json:"total"`
	Failed      int      `json:"failed"`
	Unsupported int      `json:"unsupported"`
	Warnings    []string `json:"warnings"`
}

type ImportPersistenceError struct {
	err error
}

func (e *ImportPersistenceError) Error() string {
	return fmt.Sprintf("persist usage import batch: %v", e.err)
}

func (e *ImportPersistenceError) Unwrap() error {
	return e.err
}

type Service struct {
	store                  *store.Store
	notifierMu             sync.RWMutex
	eventsInsertedNotifier func()
}

const importBatchSize = 256

func New(store *store.Store) *Service {
	return &Service{store: store}
}

func (s *Service) SetEventsInsertedNotifier(notifier func()) {
	s.notifierMu.Lock()
	s.eventsInsertedNotifier = notifier
	s.notifierMu.Unlock()
}

func (s *Service) notifyEventsInserted() {
	s.notifierMu.RLock()
	notifier := s.eventsInsertedNotifier
	s.notifierMu.RUnlock()
	if notifier != nil {
		notifier()
	}
}

func (s *Service) WriteCompatibleUsage(ctx context.Context, writer io.Writer, limit int) error {
	return s.store.WriteCompatibleUsage(ctx, writer, limit)
}

func (s *Service) WriteExport(ctx context.Context, writer io.Writer, limit int) error {
	return s.store.WriteExportJSONL(ctx, writer, limit)
}

func (s *Service) Import(ctx context.Context, reader io.Reader) (ImportResult, *usageparser.ImportStreamResult, error) {
	var added int
	var skipped int
	parsed, err := usageparser.StreamImportPayload(reader, importBatchSize, func(events []usageparser.Event) error {
		result, err := s.store.InsertEvents(ctx, events)
		if err != nil {
			return &ImportPersistenceError{err: err}
		}
		added += result.Inserted
		skipped += result.Skipped
		return nil
	})
	if added > 0 {
		s.notifyEventsInserted()
	}
	result := ImportResult{
		Format:      parsed.Format,
		Added:       added,
		Skipped:     skipped,
		Total:       parsed.Total,
		Failed:      parsed.Failed,
		Unsupported: parsed.Unsupported,
		Warnings:    parsed.Warnings,
	}
	if err != nil {
		return result, &parsed, err
	}
	return result, &parsed, nil
}

func (s *Service) Counts(ctx context.Context) (events int64, deadLetters int64, err error) {
	return s.store.Counts(ctx)
}
