export const INVESTO_LOGO_SRC = '/big-investo-logo.png';

export type InvestoLogoProps = {
  className?: string;
  /** Render height in CSS pixels; width scales with aspect ratio. */
  height?: number;
  alt?: string;
};

export default function InvestoLogo({
  className = '',
  height = 40,
  alt = 'BIG INVESTO',
}: InvestoLogoProps) {
  return (
    <img
      src={INVESTO_LOGO_SRC}
      alt={alt}
      height={height}
      style={{ height, width: 'auto' }}
      className={`block w-auto max-w-full object-contain ${className}`.trim()}
      decoding="async"
    />
  );
}
