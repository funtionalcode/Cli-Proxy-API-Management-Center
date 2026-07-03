import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi, type AuthFileFieldsPatch } from '@/services/api';
import { apiClient } from '@/services/api/client';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { formatFileSize } from '@/utils/format';
import { MAX_AUTH_FILE_SIZE } from '@/utils/constants';
import { downloadBlob } from '@/utils/download';
import {
  convertAuthJsonInput,
  getDefaultSub2ApiAuthFileName,
  getDefaultSessionAuthFileName,
  type AuthJsonConversionResult,
  type AuthJsonInputType,
} from '@/features/authFiles/sessionAuthConverter';
import {
  getTypeLabel,
  hasAuthFileStatusMessage,
  isHealthyAuthFile,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
} from '@/features/authFiles/constants';
import {
  getAuthFileNameFromSelectionKey,
  getAuthFileSelectionKey,
  type AuthFilePatchTarget,
} from '@/features/authFiles/model/authFilesPageModel';

type DeleteAllOptions = {
  filter: string;
  problemOnly: boolean;
  disabledOnly: boolean;
  healthyOnly: boolean;
  filteredFiles?: AuthFileItem[];
  onResetFilterToAll: () => void;
  onResetProblemOnly: () => void;
  onResetDisabledOnly: () => void;
  onResetHealthyOnly: () => void;
  onResetResultFilters?: () => void;
};

export type AuthFilesBatchPatchResult = {
  success: number;
  failed: number;
  failedNames: string[];
};

export type UseAuthFilesDataResult = {
  files: AuthFileItem[];
  selectedFiles: Set<string>;
  selectionCount: number;
  loading: boolean;
  error: string;
  uploading: boolean;
  authJsonPasteSaving: boolean;
  deleting: string | null;
  deletingAll: boolean;
  statusUpdating: Record<string, boolean>;
  batchStatusUpdating: boolean;
  batchFieldsUpdating: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  loadFiles: (options?: { throwOnError?: boolean }) => Promise<void>;
  handleUploadClick: () => void;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  savePastedAuthJson: (
    type: AuthJsonInputType,
    fileName: string,
    jsonText: string
  ) => Promise<string>;
  handleDelete: (name: string) => void;
  handleDeleteAll: (options: DeleteAllOptions) => void;
  handleDownload: (name: string) => Promise<void>;
  handleStatusToggle: (item: AuthFileItem, enabled: boolean) => Promise<void>;
  toggleSelect: (key: string) => void;
  selectAllVisible: (visibleFiles: AuthFileItem[]) => void;
  invertVisibleSelection: (visibleFiles: AuthFileItem[]) => void;
  deselectAll: () => void;
  batchDownload: (names: string[]) => Promise<void>;
  batchSetStatus: (names: string[], enabled: boolean) => Promise<void>;
  batchPatchFields: (
    targets: AuthFilePatchTarget[],
    fields: AuthFileFieldsPatch
  ) => Promise<AuthFilesBatchPatchResult | null>;
  batchDelete: (names: string[]) => void;
};

type PastedAuthJsonPayload = {
  authJson: AuthJsonConversionResult;
  resolvedFileName: string;
};

type AuthFilePatchTargetGroup = {
  name: string;
  targets: AuthFilePatchTarget[];
  authIndexes: Array<string | number>;
};

const normalizePatchTargetAuthIndex = (
  value: AuthFilePatchTarget['authIndex']
): string | number | null => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return typeof value === 'number' ? value : trimmed;
};

const getPatchTargetKey = (target: AuthFilePatchTarget): string => {
  const authIndex = normalizePatchTargetAuthIndex(target.authIndex);
  return `${target.name}\u0000${authIndex === null ? '-' : String(authIndex)}`;
};

const normalizeBatchPatchTargets = (targets: AuthFilePatchTarget[]): AuthFilePatchTarget[] => {
  const seen = new Set<string>();
  const normalized: AuthFilePatchTarget[] = [];

  targets.forEach((target) => {
    const name = String(target.name ?? '').trim();
    if (!name) return;
    const authIndex = normalizePatchTargetAuthIndex(target.authIndex);
    const normalizedTarget = authIndex === null ? { name } : { name, authIndex };
    const key = getPatchTargetKey(normalizedTarget);
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(normalizedTarget);
  });

  return normalized;
};

const groupBatchPatchTargets = (targets: AuthFilePatchTarget[]): AuthFilePatchTargetGroup[] => {
  const groups = new Map<string, AuthFilePatchTargetGroup>();

  targets.forEach((target) => {
    const group = groups.get(target.name) ?? {
      name: target.name,
      targets: [],
      authIndexes: [],
    };
    group.targets.push(target);
    const authIndex = normalizePatchTargetAuthIndex(target.authIndex);
    if (authIndex !== null) {
      group.authIndexes.push(authIndex);
    }
    groups.set(target.name, group);
  });

  return Array.from(groups.values());
};

export const buildPastedAuthJsonPayload = (
  type: AuthJsonInputType,
  fileName: string,
  jsonText: string
): PastedAuthJsonPayload => {
  const authJson = convertAuthJsonInput(jsonText, type);
  const resolvedFileName =
    type === 'session' && fileName === 'codex-account.json'
      ? getDefaultSessionAuthFileName(authJson as Record<string, unknown>)
      : type === 'sub2api' && fileName === 'codex-account.json'
        ? getDefaultSub2ApiAuthFileName(authJson)
        : fileName;
  return {
    authJson,
    resolvedFileName,
  };
};

export function useAuthFilesData(): UseAuthFilesDataResult {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [authJsonPasteSaving, setAuthJsonPasteSaving] = useState(false);
  const authJsonPasteSavingRef = useRef(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>({});
  const [batchStatusUpdating, setBatchStatusUpdating] = useState(false);
  const [batchFieldsUpdating, setBatchFieldsUpdating] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const batchStatusPendingRef = useRef(false);
  const batchFieldsPendingRef = useRef(false);
  const selectionCount = selectedFiles.size;
  const toggleSelect = useCallback((key: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback((visibleFiles: AuthFileItem[]) => {
    const nextSelected = visibleFiles
      .filter((file) => !isRuntimeOnlyAuthFile(file))
      .map(getAuthFileSelectionKey);
    if (nextSelected.length === 0) return;
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      nextSelected.forEach((key) => next.add(key));
      return next;
    });
  }, []);

  const invertVisibleSelection = useCallback((visibleFiles: AuthFileItem[]) => {
    const visibleNames = visibleFiles
      .filter((file) => !isRuntimeOnlyAuthFile(file))
      .map(getAuthFileSelectionKey);
    if (visibleNames.length === 0) return;

    setSelectedFiles((prev) => {
      const next = new Set(prev);
      visibleNames.forEach((key) => {
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
      });
      return next;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const applyDeletedFiles = useCallback((names: string[]) => {
    const deletedNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
    if (deletedNames.length === 0) return;

    const deletedSet = new Set(deletedNames);
    setFiles((prev) => prev.filter((file) => !deletedSet.has(file.name)));
    setSelectedFiles((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      prev.forEach((key) => {
        const name = getAuthFileNameFromSelectionKey(key);
        if (deletedSet.has(name)) {
          changed = true;
        } else {
          next.add(key);
        }
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (selectedFiles.size === 0) return;
    const existingKeys = new Set(files.map(getAuthFileSelectionKey));
    setSelectedFiles((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((key) => {
        if (existingKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [files, selectedFiles.size]);

  const loadFiles = useCallback(
    async (options?: { throwOnError?: boolean }) => {
      setLoading(true);
      setError('');
      try {
        const data = await authFilesApi.list();
        setFiles(data?.files || []);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
        setError(errorMessage);
        if (options?.throwOnError) {
          throw err instanceof Error ? err : new Error(errorMessage);
        }
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;

      const filesToUpload = Array.from(fileList);
      const validFiles: File[] = [];
      const invalidFiles: string[] = [];
      const oversizedFiles: string[] = [];

      filesToUpload.forEach((file) => {
        if (!file.name.endsWith('.json')) {
          invalidFiles.push(file.name);
          return;
        }
        if (file.size > MAX_AUTH_FILE_SIZE) {
          oversizedFiles.push(file.name);
          return;
        }
        validFiles.push(file);
      });

      if (invalidFiles.length > 0) {
        showNotification(t('auth_files.upload_error_json'), 'error');
      }
      if (oversizedFiles.length > 0) {
        showNotification(
          t('auth_files.upload_error_size', { maxSize: formatFileSize(MAX_AUTH_FILE_SIZE) }),
          'error'
        );
      }

      if (validFiles.length === 0) {
        event.target.value = '';
        return;
      }

      setUploading(true);
      try {
        const result = await authFilesApi.uploadFiles(validFiles);
        const successCount = result.uploaded;

        if (successCount > 0) {
          const suffix = validFiles.length > 1 ? ` (${successCount}/${validFiles.length})` : '';
          showNotification(
            `${t('auth_files.upload_success')}${suffix}`,
            result.failed.length ? 'warning' : 'success'
          );
          await loadFiles();
        }

        if (result.failed.length > 0) {
          const details = result.failed.map((item) => `${item.name}: ${item.error}`).join('; ');
          showNotification(`${t('notification.upload_failed')}: ${details}`, 'error');
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        showNotification(`${t('notification.upload_failed')}: ${errorMessage}`, 'error');
      } finally {
        setUploading(false);
        event.target.value = '';
      }
    },
    [loadFiles, showNotification, t]
  );

  const savePastedAuthJson = useCallback(
    async (type: AuthJsonInputType, fileName: string, jsonText: string) => {
      if (authJsonPasteSavingRef.current) {
        throw new Error(t('auth_files.paste_error_save_in_progress'));
      }
      authJsonPasteSavingRef.current = true;
      setAuthJsonPasteSaving(true);
      try {
        const { authJson, resolvedFileName } = buildPastedAuthJsonPayload(type, fileName, jsonText);
        try {
          await authFilesApi.saveJsonObject(resolvedFileName, authJson);
        } catch {
          throw new Error(t('notification.save_failed'));
        }
        try {
          await loadFiles({ throwOnError: true });
        } catch (reloadError) {
          const reloadMessage =
            reloadError instanceof Error ? reloadError.message : t('notification.refresh_failed');
          showNotification(t('auth_files.paste_success', { name: resolvedFileName }), 'success');
          showNotification(`${t('notification.refresh_failed')}: ${reloadMessage}`, 'warning');
          return resolvedFileName;
        }
        showNotification(t('auth_files.paste_success', { name: resolvedFileName }), 'success');
        return resolvedFileName;
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : t('notification.save_failed'));
      } finally {
        authJsonPasteSavingRef.current = false;
        setAuthJsonPasteSaving(false);
      }
    },
    [loadFiles, showNotification, t]
  );

  const handleDelete = useCallback(
    (name: string) => {
      showConfirmation({
        title: t('auth_files.delete_title', { defaultValue: 'Delete File' }),
        message: `${t('auth_files.delete_confirm')} "${name}" ?`,
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          setDeleting(name);
          try {
            const result = await authFilesApi.deleteFile(name);
            showNotification(t('auth_files.delete_success'), 'success');
            applyDeletedFiles(result.files.length > 0 ? result.files : [name]);
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          } finally {
            setDeleting(null);
          }
        },
      });
    },
    [applyDeletedFiles, showConfirmation, showNotification, t]
  );

  const handleDeleteAll = useCallback(
    (deleteAllOptions: DeleteAllOptions) => {
      const {
        filter,
        problemOnly,
        disabledOnly,
        healthyOnly,
        filteredFiles,
        onResetFilterToAll,
        onResetProblemOnly,
        onResetDisabledOnly,
        onResetHealthyOnly,
        onResetResultFilters,
      } = deleteAllOptions;
      const normalizedFilter = normalizeProviderKey(filter);
      const isFiltered = normalizedFilter !== 'all';
      const isProblemOnly = problemOnly === true;
      const isDisabledOnly = disabledOnly === true;
      const isHealthyOnly = healthyOnly === true;
      const usesProvidedFilteredFiles = Array.isArray(filteredFiles);
      const isFilteredResult = usesProvidedFilteredFiles || isDisabledOnly || isHealthyOnly;
      const typeLabel = isFiltered ? getTypeLabel(t, normalizedFilter) : t('auth_files.filter_all');
      let confirmMessage = t('auth_files.delete_all_confirm');
      if (isFilteredResult) {
        confirmMessage = t('auth_files.delete_filtered_result_confirm_file_scope');
      } else if (isProblemOnly) {
        confirmMessage = isFiltered
          ? t('auth_files.delete_problem_filtered_confirm', { type: typeLabel })
          : t('auth_files.delete_problem_confirm');
      } else if (isFiltered) {
        confirmMessage = t('auth_files.delete_filtered_confirm', { type: typeLabel });
      }

      showConfirmation({
        title: t('auth_files.delete_all_title', { defaultValue: 'Delete All Files' }),
        message: confirmMessage,
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          setDeletingAll(true);
          try {
            if (
              !isFiltered &&
              !isProblemOnly &&
              !isDisabledOnly &&
              !isHealthyOnly &&
              !usesProvidedFilteredFiles
            ) {
              await authFilesApi.deleteAll();
              showNotification(t('auth_files.delete_all_success'), 'success');
              setFiles((prev) => prev.filter((file) => isRuntimeOnlyAuthFile(file)));
              deselectAll();
            } else {
              const filesToDelete = (
                usesProvidedFilteredFiles
                  ? filteredFiles
                  : files.filter((file) => {
                      if (
                        isFiltered &&
                        normalizeProviderKey(String(file.type ?? file.provider ?? '')) !==
                          normalizedFilter
                      ) {
                        return false;
                      }
                      if (isProblemOnly && !hasAuthFileStatusMessage(file)) return false;
                      if (isDisabledOnly && file.disabled !== true) return false;
                      if (isHealthyOnly && !isHealthyAuthFile(file)) return false;
                      return true;
                    })
              ).filter((file) => !isRuntimeOnlyAuthFile(file));

              if (filesToDelete.length === 0) {
                let emptyMessage = t('auth_files.delete_filtered_none', { type: typeLabel });
                if (isFilteredResult) {
                  emptyMessage = t('auth_files.delete_filtered_result_none');
                } else if (isProblemOnly) {
                  emptyMessage = isFiltered
                    ? t('auth_files.delete_problem_filtered_none', { type: typeLabel })
                    : t('auth_files.delete_problem_none');
                }
                showNotification(emptyMessage, 'info');
                setDeletingAll(false);
                return;
              }

              const result = await authFilesApi.deleteFiles(filesToDelete.map((file) => file.name));
              const success = result.deleted;
              const failed = result.failed.length;

              applyDeletedFiles(result.files);

              if (failed === 0 && isFilteredResult) {
                showNotification(
                  t('auth_files.delete_filtered_result_success', { count: success }),
                  'success'
                );
              } else if (failed === 0 && isProblemOnly) {
                showNotification(
                  isFiltered
                    ? t('auth_files.delete_problem_filtered_success', {
                        count: success,
                        type: typeLabel,
                      })
                    : t('auth_files.delete_problem_success', { count: success }),
                  'success'
                );
              } else if (failed === 0) {
                showNotification(
                  t('auth_files.delete_filtered_success', { count: success, type: typeLabel }),
                  'success'
                );
              } else if (isFilteredResult) {
                showNotification(
                  t('auth_files.delete_filtered_result_partial', { success, failed }),
                  'warning'
                );
              } else if (isProblemOnly) {
                showNotification(
                  isFiltered
                    ? t('auth_files.delete_problem_filtered_partial', {
                        success,
                        failed,
                        type: typeLabel,
                      })
                    : t('auth_files.delete_problem_partial', { success, failed }),
                  'warning'
                );
              } else {
                showNotification(
                  t('auth_files.delete_filtered_partial', { success, failed, type: typeLabel }),
                  'warning'
                );
              }

              if (isFiltered) {
                onResetFilterToAll();
              }
              if (isProblemOnly) {
                onResetProblemOnly();
              }
              if (isDisabledOnly) {
                onResetDisabledOnly();
              }
              if (isHealthyOnly) {
                onResetHealthyOnly();
              }
              if (usesProvidedFilteredFiles) {
                onResetResultFilters?.();
              }
            }
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          } finally {
            setDeletingAll(false);
          }
        },
      });
    },
    [applyDeletedFiles, deselectAll, files, showConfirmation, showNotification, t]
  );

  const handleDownload = useCallback(
    async (name: string) => {
      try {
        const response = await apiClient.getRaw(
          `/auth-files/download?name=${encodeURIComponent(name)}`,
          { responseType: 'blob' }
        );
        const blob = new Blob([response.data]);
        downloadBlob({ filename: name, blob });
        showNotification(t('auth_files.download_success'), 'success');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
      }
    },
    [showNotification, t]
  );

  const handleStatusToggle = useCallback(
    async (item: AuthFileItem, enabled: boolean) => {
      const name = item.name;
      const nextDisabled = !enabled;
      const previousDisabled = item.disabled === true;

      setStatusUpdating((prev) => ({ ...prev, [name]: true }));
      setFiles((prev) => prev.map((f) => (f.name === name ? { ...f, disabled: nextDisabled } : f)));

      try {
        const res = await authFilesApi.setStatus(name, nextDisabled);
        setFiles((prev) =>
          prev.map((f) => (f.name === name ? { ...f, disabled: res.disabled } : f))
        );
        showNotification(
          enabled
            ? t('auth_files.status_enabled_success', { name })
            : t('auth_files.status_disabled_success', { name }),
          'success'
        );
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        setFiles((prev) =>
          prev.map((f) => (f.name === name ? { ...f, disabled: previousDisabled } : f))
        );
        showNotification(`${t('notification.update_failed')}: ${errorMessage}`, 'error');
      } finally {
        setStatusUpdating((prev) => {
          if (!prev[name]) return prev;
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    },
    [showNotification, t]
  );

  const batchSetStatus = useCallback(
    async (names: string[], enabled: boolean) => {
      if (batchStatusPendingRef.current) return;

      const uniqueNames = Array.from(new Set(names));
      if (uniqueNames.length === 0) return;
      if (uniqueNames.some((name) => statusUpdating[name] === true)) return;

      const originalDisabled = new Map(
        files
          .filter((file) => uniqueNames.includes(file.name))
          .map((file) => [file.name, file.disabled === true])
      );
      const targetNames = new Set(originalDisabled.keys());
      const targetNameList = Array.from(targetNames);
      if (targetNameList.length === 0) return;

      const nextDisabled = !enabled;

      batchStatusPendingRef.current = true;
      setBatchStatusUpdating(true);
      setStatusUpdating((prev) => {
        const next = { ...prev };
        targetNameList.forEach((name) => {
          next[name] = true;
        });
        return next;
      });
      setFiles((prev) =>
        prev.map((file) =>
          targetNames.has(file.name) ? { ...file, disabled: nextDisabled } : file
        )
      );

      try {
        const results = await Promise.allSettled(
          targetNameList.map((name) => authFilesApi.setStatus(name, nextDisabled))
        );

        let successCount = 0;
        let failCount = 0;
        const failedNames = new Set<string>();
        const confirmedDisabled = new Map<string, boolean>();

        results.forEach((result, index) => {
          const name = targetNameList[index];
          if (result.status === 'fulfilled') {
            successCount++;
            confirmedDisabled.set(name, result.value.disabled);
          } else {
            failCount++;
            failedNames.add(name);
          }
        });

        setFiles((prev) =>
          prev.map((file) => {
            if (failedNames.has(file.name)) {
              return { ...file, disabled: originalDisabled.get(file.name) === true };
            }
            if (confirmedDisabled.has(file.name)) {
              return { ...file, disabled: confirmedDisabled.get(file.name) };
            }
            return file;
          })
        );

        if (failCount === 0) {
          showNotification(
            t('auth_files.batch_status_success', { count: successCount }),
            'success'
          );
        } else {
          showNotification(
            t('auth_files.batch_status_partial', { success: successCount, failed: failCount }),
            'warning'
          );
        }

        deselectAll();
      } finally {
        batchStatusPendingRef.current = false;
        setBatchStatusUpdating(false);
        setStatusUpdating((prev) => {
          const next = { ...prev };
          targetNameList.forEach((name) => {
            delete next[name];
          });
          return next;
        });
      }
    },
    [deselectAll, files, showNotification, statusUpdating, t]
  );

  const batchPatchFields = useCallback(
    async (
      targets: AuthFilePatchTarget[],
      fields: AuthFileFieldsPatch
    ): Promise<AuthFilesBatchPatchResult | null> => {
      if (batchFieldsPendingRef.current) return null;

      const normalizedTargets = normalizeBatchPatchTargets(targets);
      if (normalizedTargets.length === 0) return null;
      if (Object.keys(fields).length === 0) return null;

      const groups = groupBatchPatchTargets(normalizedTargets);
      batchFieldsPendingRef.current = true;
      setBatchFieldsUpdating(true);

      try {
        const results = await Promise.allSettled(
          groups.map((group) => {
            if (group.authIndexes.length > 0 && group.authIndexes.length === group.targets.length) {
              return authFilesApi.patchFieldsForAuthIndexes(group.name, group.authIndexes, fields);
            }
            return authFilesApi.patchFields(group.name, fields);
          })
        );

        let success = 0;
        let failed = 0;
        const failedNames: string[] = [];

        results.forEach((result, index) => {
          const group = groups[index];
          if (result.status === 'fulfilled') {
            success += group.targets.length;
            return;
          }
          failed += group.targets.length;
          failedNames.push(group.name);
        });

        if (success > 0) {
          try {
            await loadFiles({ throwOnError: true });
          } catch (err: unknown) {
            const errorMessage =
              err instanceof Error ? err.message : t('notification.refresh_failed');
            showNotification(`${t('notification.refresh_failed')}: ${errorMessage}`, 'warning');
          }
        }

        if (failed === 0) {
          showNotification(t('auth_files.batch_fields_success', { count: success }), 'success');
        } else {
          showNotification(t('auth_files.batch_fields_partial', { success, failed }), 'warning');
        }

        deselectAll();
        return { success, failed, failedNames };
      } finally {
        batchFieldsPendingRef.current = false;
        setBatchFieldsUpdating(false);
      }
    },
    [deselectAll, loadFiles, showNotification, t]
  );

  const batchDownload = useCallback(
    async (names: string[]) => {
      const uniqueNames = Array.from(new Set(names));
      if (uniqueNames.length === 0) return;

      let successCount = 0;
      let failCount = 0;

      for (const name of uniqueNames) {
        try {
          const response = await apiClient.getRaw(
            `/auth-files/download?name=${encodeURIComponent(name)}`,
            { responseType: 'blob' }
          );
          const blob = new Blob([response.data]);
          downloadBlob({ filename: name, blob });
          successCount++;
        } catch {
          failCount++;
        }
      }

      if (failCount === 0) {
        showNotification(
          t('auth_files.batch_download_success', { count: successCount }),
          'success'
        );
      } else {
        showNotification(
          t('auth_files.batch_download_partial', { success: successCount, failed: failCount }),
          'warning'
        );
      }
    },
    [showNotification, t]
  );

  const batchDelete = useCallback(
    (names: string[]) => {
      const uniqueNames = Array.from(new Set(names));
      if (uniqueNames.length === 0) return;

      showConfirmation({
        title: t('auth_files.batch_delete_title'),
        message: t('auth_files.batch_delete_confirm', { count: uniqueNames.length }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          try {
            const result = await authFilesApi.deleteFiles(uniqueNames);
            applyDeletedFiles(result.files);

            if (result.failed.length === 0) {
              showNotification(
                `${t('auth_files.delete_all_success')} (${result.deleted})`,
                'success'
              );
            } else {
              showNotification(
                t('auth_files.delete_filtered_partial', {
                  success: result.deleted,
                  failed: result.failed.length,
                  type: t('auth_files.filter_all'),
                }),
                'warning'
              );
            }
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          }
        },
      });
    },
    [applyDeletedFiles, showConfirmation, showNotification, t]
  );

  return {
    files,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    authJsonPasteSaving,
    deleting,
    deletingAll,
    statusUpdating,
    batchStatusUpdating,
    batchFieldsUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    savePastedAuthJson,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchPatchFields,
    batchDelete,
  };
}
