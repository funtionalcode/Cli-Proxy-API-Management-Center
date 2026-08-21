package processlock

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

var (
	ErrLocked     = errors.New("manager database process lock is already held")
	ErrHardLinked = errors.New("manager database has multiple hard links")
)

type Lock struct {
	file         *os.File
	databasePath string
	lockPath     string
	closeOnce    sync.Once
	closeErr     error
}

func Acquire(databasePath string) (*Lock, error) {
	absolutePath, err := resolveDatabasePath(databasePath)
	if err != nil {
		return nil, err
	}
	lockPath := absolutePath + ".manager.lock"
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open manager database process lock %s: %w", lockPath, err)
	}
	if err := lockFile(file); err != nil {
		_ = file.Close()
		if errors.Is(err, ErrLocked) {
			return nil, fmt.Errorf("%w for %s", ErrLocked, absolutePath)
		}
		return nil, fmt.Errorf("acquire manager database process lock %s: %w", lockPath, err)
	}
	if err := rejectHardLinkedDatabase(absolutePath); err != nil {
		_ = errors.Join(unlockFile(file), file.Close())
		return nil, err
	}
	return &Lock{
		file:         file,
		databasePath: absolutePath,
		lockPath:     lockPath,
	}, nil
}

func rejectHardLinkedDatabase(databasePath string) error {
	file, err := os.Open(databasePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect manager database links %s: %w", databasePath, err)
	}
	multiple, inspectErr := hasMultipleLinks(file)
	closeErr := file.Close()
	if inspectErr != nil || closeErr != nil {
		return fmt.Errorf("inspect manager database links %s: %w", databasePath, errors.Join(inspectErr, closeErr))
	}
	if multiple {
		return fmt.Errorf("%w for %s; replace hard-link aliases with one canonical database path", ErrHardLinked, databasePath)
	}
	return nil
}

func resolveDatabasePath(databasePath string) (string, error) {
	absolutePath, err := filepath.Abs(databasePath)
	if err != nil {
		return "", fmt.Errorf("resolve manager database path: %w", err)
	}
	absolutePath = filepath.Clean(absolutePath)
	directory := filepath.Dir(absolutePath)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return "", fmt.Errorf("create manager database directory: %w", err)
	}
	resolvedDirectory, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return "", fmt.Errorf("resolve manager database directory: %w", err)
	}
	resolvedPath := filepath.Join(resolvedDirectory, filepath.Base(absolutePath))
	if existingPath, err := filepath.EvalSymlinks(resolvedPath); err == nil {
		resolvedPath = existingPath
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("resolve manager database file: %w", err)
	} else if info, lstatErr := os.Lstat(resolvedPath); lstatErr == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("resolve manager database file: %s is a dangling symbolic link", resolvedPath)
		}
	} else if !os.IsNotExist(lstatErr) {
		return "", fmt.Errorf("inspect manager database file: %w", lstatErr)
	}
	return filepath.Clean(resolvedPath), nil
}

func (l *Lock) DatabasePath() string {
	if l == nil {
		return ""
	}
	return l.databasePath
}

func (l *Lock) Path() string {
	if l == nil {
		return ""
	}
	return l.lockPath
}

func (l *Lock) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	l.closeOnce.Do(func() {
		l.closeErr = errors.Join(unlockFile(l.file), l.file.Close())
	})
	return l.closeErr
}
