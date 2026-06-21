import InvestoLogo from './InvestoLogo';

type AuthBrandMarkProps = {
  height?: number;
  className?: string;
  align?: 'center' | 'start';
};

export default function AuthBrandMark({
  height = 52,
  className = '',
  align = 'center',
}: AuthBrandMarkProps) {
  return (
    <div
      className={`flex w-full ${align === 'center' ? 'justify-center' : 'justify-center lg:justify-start'} ${className}`.trim()}
    >
      <InvestoLogo height={height} />
    </div>
  );
}
