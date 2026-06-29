import './InvestoLogo.css';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

// INVESTO-20260629-AUTH-BRAND-RESTORE: use the cropped transparent logo, not the padded square source.
export const INVESTO_LOGO_SRC = '/big-investo-logo-cropped.png';

/** Wide logo aspect ratio (w÷h) after transparent crop — keeps layout stable. */
export const INVESTO_LOGO_ASPECT = 930 / 290;

export type InvestoLogoProps = {
  className?: string;
  /** Render height in CSS pixels; width follows aspect ratio unless `width` is set. */
  height?: number;
  width?: number;
  alt?: string;
  /** Subtle gold pulse — login splash, loaders */
  glow?: boolean;
  /** Extra glow on dark panels (sidebar, auth left rail) */
  onDark?: boolean;
  resolutionId?: string;
};

export default function InvestoLogo({
  className = '',
  height = 40,
  width,
  alt = 'BIG INVESTO',
  glow = false,
  onDark = false,
  resolutionId,
}: InvestoLogoProps) {
  const style = width
    ? { width, height: 'auto' as const }
    : { height, width: Math.round(height * INVESTO_LOGO_ASPECT) };

  return (
    <img
      src={INVESTO_LOGO_SRC}
      alt={alt}
      width={width ?? style.width}
      height={height}
      style={width ? style : { height: style.height, width: style.width }}
      className={[
        'investo-logo',
        glow ? 'investo-logo--glow' : '',
        onDark ? 'investo-logo--on-dark' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-resolution-id={resolutionId ?? (onDark ? RESOLUTION_IDS.DASHBOARD_SHELL_LOGO_COMPAT : undefined)}
      decoding="async"
      draggable={false}
    />
  );
}
