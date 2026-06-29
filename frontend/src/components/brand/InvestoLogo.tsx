import './InvestoLogo.css';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

// INVESTO-20260629-ACTUAL-LOGO-ASSET: generated from the provided actual logo source.
export const INVESTO_LOGO_SRC = '/big-investo-logo-cropped.png';

/** Wide logo aspect ratio after transparent crop; keeps layout stable. */
export const INVESTO_LOGO_ASPECT = 1400 / 514;

export type InvestoLogoProps = {
  className?: string;
  /** Render height in CSS pixels; width follows aspect ratio unless `width` is set. */
  height?: number;
  width?: number;
  alt?: string;
  /** Subtle gold pulse for login splash and loaders. */
  glow?: boolean;
  /** Extra glow on dark panels, including sidebar and auth rail. */
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
      data-resolution-id={
        resolutionId ?? (onDark ? RESOLUTION_IDS.DASHBOARD_SHELL_LOGO_COMPAT : RESOLUTION_IDS.ACTUAL_LOGO_ASSET)
      }
      decoding="async"
      draggable={false}
    />
  );
}
