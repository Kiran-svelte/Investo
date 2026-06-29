import * as MotionReact from 'motion/react';
import type React from 'react';

// INVESTO-20260629-PAYMENT-LOCKOUT:
// Keep the runtime package but widen its React motion component types so the
// existing animation props compile consistently across npm installs.
type AnyMotionComponent = React.ComponentType<any>;

export const motion = MotionReact.motion as unknown as Record<string, AnyMotionComponent>;
export const AnimatePresence = MotionReact.AnimatePresence as React.ComponentType<any>;
export const LayoutGroup = MotionReact.LayoutGroup as React.ComponentType<any>;
export const useReducedMotion = MotionReact.useReducedMotion as () => boolean | null;
