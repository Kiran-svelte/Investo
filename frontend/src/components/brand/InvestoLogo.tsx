import { RESOLUTION_IDS } from '../../constants/resolutionIds';

export const INVESTO_LOGO_SRC = '/big-investo-logo.png';

export type InvestoLogoProps = {
  className?: string;
  /** Render height in CSS pixels; width scales with aspect ratio. */
  height?: number;
  alt?: string;
  onDark?: boolean;
};

export default function InvestoLogo({
  className = '',
  height = 40,
  alt = 'BIG INVESTO',
  onDark = false,
}: InvestoLogoProps) {
  return (
    <img
      src={INVESTO_LOGO_SRC}
      alt={alt}
      height={height}
      className={`block w-auto max-w-full object-contain ${onDark ? 'drop-shadow-[0_1px_8px_rgba(255,255,255,0.22)]' : ''} ${className}`.trim()}
      data-resolution-id={onDark ? RESOLUTION_IDS.DASHBOARD_SHELL_LOGO_COMPAT : undefined}
      decoding="async"
    />
  );
}
