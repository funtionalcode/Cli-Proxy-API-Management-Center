import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import {
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconRefreshCw,
} from '@/components/ui/icons';
import { oauthApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import type { CodexReauthTarget } from './codexReauthModel';
import styles from './CodexReauthDialog.module.scss';

type CodexReauthStatus = 'idle' | 'loading' | 'waiting' | 'success' | 'error';

type CodexReauthDialogProps = {
  open: boolean;
  target: CodexReauthTarget | null;
  onClose: () => void;
  onSuccess?: () => void | Promise<void>;
};

const POLL_INTERVAL_MS = 3000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return typeof error === 'string' ? error : '';
};

export function CodexReauthDialog({
  open,
  target,
  onClose,
  onSuccess,
}: CodexReauthDialogProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [authUrl, setAuthUrl] = useState('');
  const [status, setStatus] = useState<CodexReauthStatus>('idle');
  const [error, setError] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [callbackSubmitting, setCallbackSubmitting] = useState(false);
  const [callbackStatus, setCallbackStatus] = useState<'success' | 'error' | undefined>();
  const [callbackError, setCallbackError] = useState('');
  const [copiedTarget, setCopiedTarget] = useState<'account' | 'link' | null>(null);
  const [linkRefreshed, setLinkRefreshed] = useState(false);
  const pollingTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const successHandledRef = useRef(false);

  const targetKey = useMemo(
    () =>
      target
        ? [target.account, target.fileName ?? '', target.authIndex ?? '', target.accountId ?? ''].join(
            '\u0000'
          )
        : '',
    [target]
  );

  const clearPolling = useCallback(() => {
    if (pollingTimerRef.current !== null) {
      window.clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, []);

  const showTemporaryFeedback = useCallback(
    (callback: () => void) => {
      clearFeedbackTimer();
      callback();
      feedbackTimerRef.current = window.setTimeout(() => {
        setCopiedTarget(null);
        setLinkRefreshed(false);
        feedbackTimerRef.current = null;
      }, 1800);
    },
    [clearFeedbackTimer]
  );

  const markSuccess = useCallback(() => {
    clearPolling();
    setStatus('success');
    setError('');
    setCallbackSubmitting(false);
    setCallbackStatus('success');
    setCallbackError('');
    if (successHandledRef.current) return;
    successHandledRef.current = true;
    showNotification(t('codex_reauth.success'), 'success');
    void Promise.resolve(onSuccess?.()).catch((err: unknown) => {
      const message = getErrorMessage(err) || t('notification.refresh_failed');
      showNotification(message, 'error');
    });
  }, [clearPolling, onSuccess, showNotification, t]);

  const startPolling = useCallback(
    (state: string) => {
      clearPolling();
      pollingTimerRef.current = window.setInterval(async () => {
        try {
          const response = await oauthApi.getAuthStatus(state);
          if (response.status === 'ok') {
            markSuccess();
            return;
          }
          if (response.status === 'error') {
            clearPolling();
            const message = response.error || t('codex_reauth.error');
            setStatus('error');
            setError(message);
            showNotification(message, 'error');
          }
        } catch (err: unknown) {
          clearPolling();
          const message = getErrorMessage(err) || t('codex_reauth.error');
          setStatus('error');
          setError(message);
        }
      }, POLL_INTERVAL_MS);
    },
    [clearPolling, markSuccess, showNotification, t]
  );

  const loadAuthLink = useCallback(async (showRefreshFeedback = false) => {
    clearPolling();
    successHandledRef.current = false;
    setAuthUrl('');
    setStatus('loading');
    setError('');
    setCallbackUrl('');
    setCallbackSubmitting(false);
    setCallbackStatus(undefined);
    setCallbackError('');
    setCopiedTarget(null);
    setLinkRefreshed(false);
    try {
      const response = await oauthApi.startAuth('codex');
      if (!response.state) {
        const message = t('codex_reauth.missing_state');
        setAuthUrl(response.url);
        setStatus('error');
        setError(message);
        showNotification(message, 'error');
        return;
      }
      setAuthUrl(response.url);
      setStatus('waiting');
      if (showRefreshFeedback) {
        showTemporaryFeedback(() => setLinkRefreshed(true));
      }
      startPolling(response.state);
    } catch (err: unknown) {
      const message = getErrorMessage(err) || t('codex_reauth.error');
      setStatus('error');
      setError(message);
      showNotification(message, 'error');
    }
  }, [clearPolling, showNotification, showTemporaryFeedback, startPolling, t]);

  useEffect(() => {
    if (!open || !target) {
      clearPolling();
      return;
    }
    const timer = window.setTimeout(() => {
      void loadAuthLink();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      clearPolling();
    };
  }, [clearPolling, loadAuthLink, open, target, targetKey]);

  useEffect(
    () => () => {
      clearPolling();
      clearFeedbackTimer();
    },
    [clearFeedbackTimer, clearPolling]
  );

  const copyText = useCallback(
    async (text: string, targetName: 'account' | 'link') => {
      if (!text) return;
      const copied = await copyToClipboard(text);
      if (copied) {
        showTemporaryFeedback(() => setCopiedTarget(targetName));
      }
      showNotification(
        t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, showTemporaryFeedback, t]
  );

  const openAuthUrl = useCallback(() => {
    if (!authUrl) return;
    window.open(authUrl, '_blank', 'noopener,noreferrer');
  }, [authUrl]);

  const submitCallback = useCallback(async () => {
    const redirectUrl = callbackUrl.trim();
    if (!redirectUrl) {
      showNotification(t('codex_reauth.callback_required'), 'warning');
      return;
    }
    setCallbackSubmitting(true);
    setCallbackStatus(undefined);
    setCallbackError('');
    try {
      await oauthApi.submitCallback('codex', redirectUrl);
      markSuccess();
    } catch (err: unknown) {
      const message = getErrorMessage(err) || t('codex_reauth.error');
      setCallbackSubmitting(false);
      setCallbackStatus('error');
      setCallbackError(message);
      showNotification(`${t('codex_reauth.error')} ${message}`.trim(), 'error');
    }
  }, [callbackUrl, markSuccess, showNotification, t]);

  const statusNode = (() => {
    if (status === 'loading') {
      return (
        <div className={`${styles.status} ${styles.statusWaiting}`}>
          {t('codex_reauth.loading_link')}
        </div>
      );
    }
    if (status === 'waiting') {
      return (
        <div className={`${styles.status} ${styles.statusWaiting}`}>
          {t('codex_reauth.waiting')}
        </div>
      );
    }
    if (status === 'success') {
      return (
        <div className={`${styles.status} ${styles.statusSuccess}`}>
          {t('codex_reauth.success')}
        </div>
      );
    }
    if (status === 'error') {
      return (
        <div className={`${styles.status} ${styles.statusError}`}>
          {error || t('codex_reauth.error')}
        </div>
      );
    }
    return null;
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('codex_reauth.title')}
      width={620}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogBody}>
        <p className={styles.hint}>{t('codex_reauth.same_account_hint')}</p>

        <div className={styles.accountSummary}>
          <span className={styles.summaryLabel}>{t('codex_reauth.account_label')}</span>
          <span className={styles.summaryValue}>{target?.account || '-'}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void copyText(target?.account || '', 'account')}
            disabled={!target?.account}
          >
            <IconCopy size={13} />
            {copiedTarget === 'account'
              ? t('codex_reauth.copied')
              : t('codex_reauth.copy_account')}
          </Button>
        </div>

        <div className={styles.oauthPanel}>
          <div className={styles.primaryActionRow}>
            <Button
              type="button"
              size="md"
              className={styles.primaryActionButton}
              onClick={openAuthUrl}
              disabled={!authUrl || status === 'loading' || status === 'success'}
            >
              <IconExternalLink size={16} />
              {t('codex_reauth.open_link')}
            </Button>
            {statusNode}
          </div>

          <div className={styles.linkPreviewRow}>
            <span className={styles.oauthLabel}>{t('codex_reauth.oauth_link_label')}</span>
            <span className={styles.linkPreview} title={authUrl || undefined}>
              {authUrl || '-'}
            </span>
          </div>

          <div className={styles.oauthActions}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void copyText(authUrl, 'link')}
              disabled={!authUrl}
            >
              <IconCopy size={14} />
              {copiedTarget === 'link' ? t('codex_reauth.copied') : t('codex_reauth.copy_link')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void loadAuthLink(true)}
              disabled={status === 'loading'}
              loading={status === 'loading'}
            >
              {!status || status !== 'loading' ? <IconRefreshCw size={14} /> : null}
              {linkRefreshed ? t('codex_reauth.link_refreshed') : t('codex_reauth.refresh_link')}
            </Button>
          </div>
        </div>

        <div className={styles.callbackSection}>
          <Input
            label={t('codex_reauth.callback_label')}
            placeholder={t('codex_reauth.callback_placeholder')}
            value={callbackUrl}
            onChange={(event) => {
              setCallbackUrl(event.target.value);
              setCallbackStatus(undefined);
              setCallbackError('');
            }}
            disabled={callbackSubmitting || status === 'success'}
          />
          <div className={styles.callbackActions}>
            <Button
              type="button"
              size="sm"
              onClick={() => void submitCallback()}
              loading={callbackSubmitting}
              disabled={callbackSubmitting || status === 'success'}
            >
              <IconCheck size={14} />
              {t('codex_reauth.submit_callback')}
            </Button>
          </div>
          {callbackStatus === 'error' ? (
            <div className={`${styles.status} ${styles.statusError}`}>
              {callbackError || t('codex_reauth.error')}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
