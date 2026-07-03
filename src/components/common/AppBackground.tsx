import './AppBackground.scss';

export function AppBackground() {
  return (
    <div className="app-background" aria-hidden="true">
      <svg className="app-background__shape app-background__shape-1" viewBox="0 0 200 200">
        <defs>
          <linearGradient id="cpa-app-bg-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--app-bg-blob-1-start)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--app-bg-blob-1-end)" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          fill="url(#cpa-app-bg-grad-1)"
          d="M44.7,-76.4C58.9,-69.2,71.8,-59.1,79.6,-46.9C87.4,-34.7,90.1,-20.4,85.8,-7.8C81.5,4.8,70.2,15.7,59.9,25.4C49.6,35.1,40.3,43.6,30.3,51.8C20.3,60,9.6,67.9,-2.7,72.6C-15,77.3,-29,78.8,-41.8,73.5C-54.6,68.2,-66.2,56.1,-73.4,42.1C-80.6,28.1,-83.4,12.2,-79.9,-2.1C-76.4,-16.4,-66.6,-29.1,-56.3,-39.8C-46,-50.5,-35.3,-59.2,-23.8,-68C-12.3,-76.8,-0.1,-85.7,13.2,-87.3C26.5,-88.9,30.5,-63.6,44.7,-76.4Z"
          transform="translate(100 100)"
        />
      </svg>
      <svg className="app-background__shape app-background__shape-2" viewBox="0 0 200 200">
        <defs>
          <linearGradient id="cpa-app-bg-grad-2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--app-bg-blob-2-start)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--app-bg-blob-2-end)" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          fill="url(#cpa-app-bg-grad-2)"
          d="M41.2,-68.8C52.4,-63.9,60.6,-50.7,68.4,-37.8C76.2,-24.9,83.6,-12.3,81.3,-0.7C78.9,10.9,66.8,21.5,56.7,31.7C46.6,41.9,38.5,51.7,28.4,59.5C18.3,67.3,6.2,73.1,-5.6,76.3C-17.4,79.5,-29,80.1,-39.8,74.7C-50.6,69.3,-60.6,57.9,-67.9,45.4C-75.2,32.9,-79.8,19.3,-77.8,6.8C-75.8,-5.7,-67.2,-17.1,-57.8,-27.1C-48.4,-37.1,-38.2,-45.7,-27.6,-51C-17,-56.3,-6,-58.3,5.6,-61.5C17.2,-64.7,30,-63.7,41.2,-68.8Z"
          transform="translate(100 100)"
        />
      </svg>
    </div>
  );
}
