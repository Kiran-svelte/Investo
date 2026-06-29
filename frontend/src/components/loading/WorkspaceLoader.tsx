import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from '../../lib/motion';
import InvestoLogo from '../brand/InvestoLogo';
import './WorkspaceLoader.css';

const STATUS_LINES = [
  'Starting your workspace…',
  'Connecting to Investo…',
  'Loading your dashboard…',
  'Almost ready…',
];

export interface WorkspaceLoaderProps {
  /** Primary line under the animation */
  message?: string;
  /** Smaller hint (e.g. cold start on Render) */
  hint?: string;
  /** Rotate status text while waiting */
  rotateStatus?: boolean;
}

const WorkspaceLoader: React.FC<WorkspaceLoaderProps> = ({
  message = 'Loading workspace…',
  hint,
  rotateStatus = true,
}) => {
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    if (!rotateStatus) return undefined;
    const id = window.setInterval(() => {
      setStatusIndex((i) => (i + 1) % STATUS_LINES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [rotateStatus]);

  const statusLine = rotateStatus ? STATUS_LINES[statusIndex] : message;

  return (
    <div className="workspace-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="workspace-loader__glow" aria-hidden="true" />
      <motion.div
        className="workspace-loader__card"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="workspace-loader__brand">
          <motion.span
            className="workspace-loader__logo"
            animate={{ rotate: [0, 4, -4, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <InvestoLogo height={36} />
          </motion.span>
          <div className="workspace-loader__brand-text">
            <AnimatePresence mode="wait">
              <motion.span
                key={statusLine}
                className="workspace-loader__subtitle"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35 }}
              >
                {statusLine}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        <div className="workspace-loader__track" aria-hidden="true">
          <motion.div
            className="workspace-loader__bar"
            initial={{ width: '8%' }}
            animate={{ width: ['8%', '72%', '38%', '88%', '52%'] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <div className="workspace-loader__skeletons" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="workspace-loader__skeleton-row"
              initial={{ opacity: 0.4 }}
              animate={{ opacity: [0.35, 0.85, 0.35] }}
              transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.22, ease: 'easeInOut' }}
            >
              <span className="workspace-loader__sk-block workspace-loader__sk-block--icon" />
              <span className="workspace-loader__sk-lines">
                <span className="workspace-loader__sk-line workspace-loader__sk-line--long" />
                <span className="workspace-loader__sk-line workspace-loader__sk-line--short" />
              </span>
            </motion.div>
          ))}
        </div>

        <p className="workspace-loader__message">{message}</p>
        {hint ? <p className="workspace-loader__hint">{hint}</p> : null}
      </motion.div>
    </div>
  );
};

export default WorkspaceLoader;
