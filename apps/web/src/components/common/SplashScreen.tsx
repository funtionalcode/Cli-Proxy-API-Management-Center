import { useEffect } from 'react';
import {
  CPAMP_VERTICAL_LOGO_ON_DARK_URL,
  CPAMP_VERTICAL_LOGO_ON_DARK_SRC_SET,
  CPAMP_VERTICAL_LOGO_SRC_SET,
  CPAMP_VERTICAL_LOGO_URL,
} from '@/assets/brand';
import './SplashScreen.scss';

interface SplashScreenProps {
  onFinish: () => void;
  fadeOut?: boolean;
}

const FADE_OUT_DURATION = 400;

export function SplashScreen({ onFinish, fadeOut = false }: SplashScreenProps) {
  useEffect(() => {
    if (!fadeOut) return;
    const finishTimer = setTimeout(() => {
      onFinish();
    }, FADE_OUT_DURATION);

    return () => {
      clearTimeout(finishTimer);
    };
  }, [fadeOut, onFinish]);

  return (
    <div className={`splash-screen ${fadeOut ? 'fade-out' : ''}`}>
      <div className="splash-content">
        <img
          src={CPAMP_VERTICAL_LOGO_URL}
          srcSet={CPAMP_VERTICAL_LOGO_SRC_SET}
          alt="CPA Manager Plus"
          className="splash-logo splash-logo-light"
        />
        <img
          src={CPAMP_VERTICAL_LOGO_ON_DARK_URL}
          srcSet={CPAMP_VERTICAL_LOGO_ON_DARK_SRC_SET}
          alt="CPA Manager Plus"
          className="splash-logo splash-logo-dark"
        />
        <div className="splash-loader">
          <div className="splash-loader-bar" />
        </div>
      </div>
    </div>
  );
}
