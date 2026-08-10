import styles from '../AccountsPage.module.scss';

interface AccountsBatchDeletePreviewProps {
  summary: string;
  warning: string;
  providers?: string;
  fileNames: string[];
  moreLabel?: string;
}

export function AccountsBatchDeletePreview({
  summary,
  warning,
  providers,
  fileNames,
  moreLabel,
}: AccountsBatchDeletePreviewProps) {
  return (
    <div className={styles.batchDeletePreview}>
      <p>{summary}</p>
      <p className={styles.batchDeletePreviewWarning}>{warning}</p>
      {providers ? <p>{providers}</p> : null}
      <ul>
        {fileNames.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      {moreLabel ? <small>{moreLabel}</small> : null}
    </div>
  );
}
