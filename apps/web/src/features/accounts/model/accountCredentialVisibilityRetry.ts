export const ACCOUNT_CREDENTIAL_VISIBILITY_RETRY_DELAYS_MS = [0, 1_000, 2_000, 4_000, 8_000] as const;

export const waitForCredentialVisibilityRetry = async (
  delayMs: number,
  isActive: () => boolean
): Promise<boolean> => {
  if (!isActive()) return false;
  if (delayMs <= 0) return true;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  return isActive();
};

export const runCredentialVisibilityRetry = async <T>({
  load,
  isUnconfirmed,
  isActive = () => true,
  retryErrors = false,
}: {
  load: () => Promise<T>;
  isUnconfirmed: (value: T) => boolean;
  isActive?: () => boolean;
  retryErrors?: boolean;
}): Promise<{ value?: T; error?: unknown; exhausted: boolean; cancelled: boolean }> => {
  let lastValue: T | undefined;
  let lastError: unknown;
  for (const delayMs of ACCOUNT_CREDENTIAL_VISIBILITY_RETRY_DELAYS_MS) {
    if (!(await waitForCredentialVisibilityRetry(delayMs, isActive))) {
      return { value: lastValue, error: lastError, exhausted: false, cancelled: true };
    }
    try {
      const value = await load();
      lastValue = value;
      if (!isUnconfirmed(value)) {
        return { value, exhausted: false, cancelled: false };
      }
    } catch (error) {
      lastError = error;
      if (!retryErrors) {
        return { value: lastValue, error: lastError, exhausted: false, cancelled: false };
      }
    }
  }
  return { value: lastValue, error: lastError, exhausted: true, cancelled: false };
};
