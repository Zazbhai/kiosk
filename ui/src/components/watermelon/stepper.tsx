'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Minus as HiMinus, Plus as HiPlus } from '@phosphor-icons/react';
import './stepper.css';

export interface StepperProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  onChange?: (val: number) => void;
  className?: string;
  size?: 'compact' | 'normal' | 'large';
}

const digitVariants = {
  initial: (dir: number) => ({
    y: dir > 0 ? 18 : -18,
    opacity: 0,
    scale: 0.5,
    z: 0,
    filter: 'blur(2px)',
  }),
  animate: {
    y: 0,
    opacity: 1,
    scale: 1,
    z: 10,
    filter: 'blur(0px)',
  },
  exit: (dir: number) => ({
    y: dir > 0 ? -18 : 18,
    opacity: 0,
    scale: 0.5,
    z: 0,
    filter: 'blur(2px)',
  }),
};

export function Stepper({
  value,
  defaultValue = 1,
  min = 1,
  max = 99,
  onChange,
  className = '',
  size = 'compact',
}: StepperProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue);
  const [direction, setDirection] = React.useState(0);

  const current = isControlled ? value! : internal;
  const digits = current.toString().split('');

  const [prevDigits, setPrevDigits] = React.useState<string[]>([]);
  const [prevTicks, setPrevTicks] = React.useState<number[]>([]);

  const len = digits.length;
  const lenDiff = len - prevDigits.length;

  const nextTicks = digits.map((digit, i) => {
    const prevI = i - lenDiff;
    const prevDigit = prevI >= 0 ? prevDigits[prevI] : undefined;
    const prevTick = prevI >= 0 ? prevTicks[prevI] : 0;

    return digit !== prevDigit ? (prevTick ?? 0) + 1 : (prevTick ?? 0);
  });

  if (prevDigits.join('') !== digits.join('')) {
    setPrevTicks(nextTicks);
    setPrevDigits(digits);
  }

  const step = (dir: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const next = Math.min(max, Math.max(min, current + dir));
    if (next === current) return;
    setDirection(dir);
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  return (
    <div
      className={`wm-stepper-container wm-stepper-${size} ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wm-stepper-track">
        <motion.button
          type="button"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 350, damping: 22 }}
          onClick={(e) => step(-1, e)}
          disabled={current <= min}
          aria-label="Decrease"
          className="wm-stepper-btn"
        >
          <HiMinus className="wm-stepper-icon" />
        </motion.button>

        <div className="wm-stepper-display">
          {digits.map((digit, index) => (
            <div
              key={`${index}-${len}`}
              className="wm-stepper-digit-slot"
            >
              <AnimatePresence
                mode="popLayout"
                initial={false}
                custom={direction}
              >
                <motion.span
                  key={nextTicks[index]}
                  custom={direction}
                  variants={digitVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{
                    type: 'spring',
                    stiffness: 220,
                    damping: 17,
                    mass: 1.1,
                  }}
                  className="wm-stepper-digit"
                >
                  {digit}
                </motion.span>
              </AnimatePresence>
            </div>
          ))}
        </div>

        <motion.button
          type="button"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 350, damping: 22 }}
          onClick={(e) => step(1, e)}
          disabled={current >= max}
          aria-label="Increase"
          className="wm-stepper-btn"
        >
          <HiPlus className="wm-stepper-icon" />
        </motion.button>
      </div>
    </div>
  );
}

export default Stepper;
