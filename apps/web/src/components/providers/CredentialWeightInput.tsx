import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import {
  MAX_CREDENTIAL_WEIGHT,
  getCredentialWeightError,
  toCredentialWeightInputValue,
  type CredentialWeightInputValue,
} from '@/utils/credentialWeight';

export type CredentialWeightInputProps = {
  value: CredentialWeightInputValue;
  disabled?: boolean;
  onChange: (value: CredentialWeightInputValue) => void;
};

export function CredentialWeightInput({ value, disabled, onChange }: CredentialWeightInputProps) {
  const { t } = useTranslation();
  const errorCode = getCredentialWeightError(value);
  const error = errorCode
    ? t(
        errorCode === 'maximum'
          ? 'ai_providers.weight_error_maximum'
          : 'ai_providers.weight_error_integer',
        { max: MAX_CREDENTIAL_WEIGHT.toLocaleString() }
      )
    : undefined;

  return (
    <Input
      label={t('ai_providers.weight_label')}
      hint={t('ai_providers.weight_hint')}
      error={error}
      type="text"
      inputMode="text"
      value={value ?? ''}
      onChange={(event) => {
        onChange(toCredentialWeightInputValue(event.target.value));
      }}
      disabled={disabled}
    />
  );
}
