import type { ChangeEvent } from 'react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import styles from '../MonitoringCenterPage.module.scss';

type MonitoringCustomRangeModalProps = {
  open: boolean;
  startInput: string;
  endInput: string;
  error: string | null;
  t: TFunction;
  onClose: () => void;
  onApply: () => void;
  onStartChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onEndChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function MonitoringCustomRangeModal({
  open,
  startInput,
  endInput,
  error,
  t,
  onClose,
  onApply,
  onStartChange,
  onEndChange,
}: MonitoringCustomRangeModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('monitoring.range_custom')}
      width={560}
      className={styles.monitorModal}
      footer={
        <div className={styles.customRangeModalFooter}>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onApply}
            disabled={Boolean(error)}
          >
            {t('common.confirm')}
          </Button>
        </div>
      }
    >
      <div className={styles.customRangeModalBody}>
        <div className={styles.customRangeModalGrid}>
          <Input
            type="datetime-local"
            label={t('monitoring.custom_range_start')}
            value={startInput}
            onChange={onStartChange}
            className={styles.customRangeInput}
            aria-invalid={Boolean(error)}
          />
          <Input
            type="datetime-local"
            label={t('monitoring.custom_range_end')}
            value={endInput}
            onChange={onEndChange}
            className={styles.customRangeInput}
            aria-invalid={Boolean(error)}
          />
        </div>
        {error ? (
          <div className={styles.customRangeError} role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
