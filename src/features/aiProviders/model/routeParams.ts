export const parseProviderIndexParam = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildProviderDraftKey = (
  provider: string,
  editIndex: number | null,
  invalidIndexParam: boolean,
  rawIndex?: string
) => {
  if (invalidIndexParam) return `${provider}:invalid:${rawIndex ?? 'unknown'}`;
  if (editIndex === null) return `${provider}:new`;
  return `${provider}:${editIndex}`;
};
