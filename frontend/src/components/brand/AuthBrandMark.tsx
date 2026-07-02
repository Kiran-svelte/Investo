import InvestoLogo from './InvestoLogo';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

type AuthBrandMarkProps = {
  height?: number;
  className?: string;
  align?: 'center' | 'start';
  glow?: boolean;
};

export default function AuthBrandMark({
  height = 52,
  className = '',
  align = 'center',
  glow = false,
}: AuthBrandMarkProps) {
  return (
    <div
      className={[
        'flex w-full min-h-[calc(var(--logo-h)*1px)] items-center',
        align === 'center' ? 'justify-center' : 'justify-center lg:justify-start',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ['--logo-h' as string]: height }}
      data-resolution-id={RESOLUTION_IDS.AUTH_BRAND_RESTORE}
    >
      <InvestoLogo
        height={height}
        glow={glow}
        className="max-w-[min(100%,320px)]"
        resolutionId={RESOLUTION_IDS.AUTH_BRAND_RESTORE}
      />
    </div>
  );
}
