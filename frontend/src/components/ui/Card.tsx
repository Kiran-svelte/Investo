import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}

export default function Card({ children, className = '', padding = true }: CardProps) {
  return (
    <div className={`investo-card ${padding ? 'p-5 md:p-6' : ''} ${className}`.trim()}>
      {children}
    </div>
  );
}
