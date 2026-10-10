'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';

import './RubberSegment.css';

const FLICK = 110;
const DEADZONE = 4;
const SLOP = 10;
const RUBBER = 0.55;
const SIZES = {
  sm: { height: 28, font: 12, pad: 10, min: 36 },
  md: { height: 36, font: 13, pad: 14, min: 44 },
  lg: { height: 44, font: 14, pad: 18, min: 48 },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rubber = (over: number, dim: number) => (over * dim * RUBBER) / (dim + RUBBER * Math.abs(over));
const project = (v: number, glide: number) => {
  const d = 1 - 0.1 * Math.pow(0.05, glide / 100);
  return ((v / 1000) * d) / (1 - d);
};
const velocityOf = (hist: [number, number][], now: number) => {
  const recent = hist.filter(([t]) => now - t <= 100);
  if (recent.length < 2) return 0;
  const [t0, x0] = recent[0];
  const [t1, x1] = recent[recent.length - 1];
  return t1 - t0 >= 8 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
};
const nearestSlot = (slots: { l: number; r: number }[], x: number) => {
  let best = 0;
  for (let i = 1; i < slots.length; i++) {
    if (Math.abs((slots[i].l + slots[i].r) / 2 - x) < Math.abs((slots[best].l + slots[best].r) / 2 - x)) best = i;
  }
  return best;
};

export interface RubberSegmentItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
}

export type RubberSegmentItemInput = string | RubberSegmentItem;

export interface RubberSegmentProps {
  items: RubberSegmentItemInput[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string, index: number) => void;
  trackColor?: string;
  thumbColor?: string;
  textColor?: string;
  activeTextColor?: string;
  size?: 'sm' | 'md' | 'lg';
  radius?: number;
  inset?: number;
  equalSlots?: boolean;
  stretch?: number;
  squash?: number;
  speed?: number;
  glide?: number;
  draggable?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export default function RubberSegment({
  items,
  value,
  defaultValue,
  onChange,
  trackColor = '#27272a',
  thumbColor = '#fafafa',
  textColor = '#fafafa',
  activeTextColor = '#18181b',
  size = 'md',
  radius = 10,
  inset = 3,
  equalSlots = true,
  speed = 1,
  glide = 75,
  draggable = true,
  disabled = false,
  className = '',
  'aria-label': ariaLabel = 'Segmented control',
}: RubberSegmentProps) {
  const list: RubberSegmentItem[] = items.map((item) =>
    typeof item === 'string' ? { value: item, label: item } : item
  );
  const [inner, setInner] = useState(defaultValue ?? list[0]?.value);
  const [optimisticValue, setOptimisticValue] = useState<string | null>(null);

  useEffect(() => {
    setOptimisticValue(null);
  }, [value]);

  const current = optimisticValue ?? (value !== undefined ? value : inner);
  const index = Math.max(
    0,
    list.findIndex((item) => item.value === current)
  );
  const reduce = useReducedMotion();

  const trackRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const slots = useRef<{ l: number; r: number }[]>([]);
  const box = useRef<DOMRect | null>(null);
  const committed = useRef(index);
  const drag = useRef<{
    id: number;
    x0: number;
    slot: number;
    onThumb: boolean;
    live: boolean;
    offset: number;
    w: number;
    hist: [number, number][];
  } | null>(null);

  const edgeL = useMotionValue(0);
  const edgeR = useMotionValue(0);
  const innerW = useMotionValue(0);
  const thumbRadius = Math.max(0, radius - inset);
  const thumbWidth = useMotionValue(0);

  // Synchronously keep thumbWidth updated whenever edgeL or edgeR changes (spring stretch & bounce)
  useEffect(() => {
    const updateWidth = () => {
      const w = Math.max(0, edgeR.get() - edgeL.get());
      thumbWidth.set(w);
    };
    const unsubL = edgeL.on('change', updateWidth);
    const unsubR = edgeR.on('change', updateWidth);
    updateWidth();
    return () => {
      unsubL();
      unsubR();
    };
  }, [edgeL, edgeR, thumbWidth]);

  const animateTo = (to: number, immediate = false) => {
    const s = slots.current[to];
    if (!s) return;
    edgeL.stop();
    edgeR.stop();
    if (immediate || reduce) {
      edgeL.set(s.l);
      edgeR.set(s.r);
      thumbWidth.set(Math.max(0, s.r - s.l));
      return;
    }

    const curL = edgeL.get();
    const curR = edgeR.get();
    const curCenter = (curL + curR) / 2;
    const targetCenter = (s.l + s.r) / 2;
    const movingRight = targetCenter >= curCenter;

    const springLead = {
      type: 'spring' as const,
      stiffness: 420 * speed,
      damping: 28,
      mass: 0.75,
    };
    const springTrail = {
      type: 'spring' as const,
      stiffness: 310 * speed,
      damping: 25,
      mass: 1.0,
    };

    if (movingRight) {
      animate(edgeR as any, s.r, springLead as any);
      animate(edgeL as any, s.l, springTrail as any);
    } else {
      animate(edgeL as any, s.l, springLead as any);
      animate(edgeR as any, s.r, springTrail as any);
    }
  };

  const measure = () => {
    const track = trackRef.current;
    if (!track) return;
    box.current = track.getBoundingClientRect();

    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    if (items.length === 0) return;

    const count = list.length || 1;
    const trackW = track.offsetWidth;

    if (equalSlots && trackW > 0) {
      const availableWidth = trackW - inset * 2;
      const slotW = availableWidth / count;
      slots.current = list.map((_, i) => ({
        l: inset + i * slotW,
        r: inset + (i + 1) * slotW,
      }));
      innerW.set(trackW);
      animateTo(committed.current, true);
    } else {
      const allRendered = items.length === count && items.every((el) => el.offsetWidth > 0);
      if (allRendered) {
        slots.current = items.map((el) => ({
          l: el.offsetLeft,
          r: el.offsetLeft + el.offsetWidth,
        }));
        innerW.set(trackW);
        animateTo(committed.current, true);
      } else {
        const fallbackW = trackW || (count * (preset.min || 44));
        const slotW = Math.max(preset.min || 44, (fallbackW - inset * 2) / count);
        slots.current = list.map((_, i) => ({
          l: inset + i * slotW,
          r: inset + (i + 1) * slotW,
        }));
        innerW.set(fallbackW);
        animateTo(committed.current, true);
      }
    }
  };

  const listKey = list.map((item) => item.value).join('|');
  useLayoutEffect(() => {
    measure();

    let raf1: number, raf2: number, raf3: number;
    raf1 = requestAnimationFrame(() => {
      measure();
      raf2 = requestAnimationFrame(() => {
        measure();
        raf3 = requestAnimationFrame(measure);
      });
    });

    const timers = [
      setTimeout(measure, 30),
      setTimeout(measure, 70),
      setTimeout(measure, 120),
      setTimeout(measure, 180),
      setTimeout(measure, 260),
      setTimeout(measure, 340),
      setTimeout(measure, 450),
      setTimeout(measure, 600),
    ];

    const observer = new ResizeObserver(() => {
      measure();
    });
    if (trackRef.current) {
      observer.observe(trackRef.current);
      const items = trackRef.current.querySelectorAll(':scope > .rubber-segment__item');
      items.forEach((item) => observer.observe(item));
    }
    if (trackRef.current?.parentElement) observer.observe(trackRef.current.parentElement);

    if (typeof document !== 'undefined' && (document as any).fonts) {
      (document as any).fonts.ready.then(measure);
    }

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cancelAnimationFrame(raf3);
      timers.forEach(clearTimeout);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, size, inset, equalSlots]);

  useEffect(() => {
    if (!drag.current && committed.current !== index) {
      committed.current = index;
      animateTo(index);
    }
  }, [index]);

  useEffect(
    () => () => {
      edgeL.stop();
      edgeR.stop();
    },
    [edgeL, edgeR]
  );

  const commit = (i: number) => {
    committed.current = i;
    const nextVal = list[i].value;
    setOptimisticValue(nextVal);
    setInner(nextVal);
    onChange?.(nextVal, i);
  };

  const localX = (e: React.PointerEvent) => {
    const track = trackRef.current;
    if (!track) return 0;
    return e.clientX - track.getBoundingClientRect().left;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>, i: number) => {
    if (disabled || drag.current || e.button !== 0) return;
    if (trackRef.current) box.current = trackRef.current.getBoundingClientRect();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    const x = localX(e);
    const onThumb = draggable && x >= edgeL.get() && x <= edgeR.get();
    drag.current = { id: e.pointerId, x0: x, slot: i, onThumb, live: false, offset: 0, w: 0, hist: [[e.timeStamp, x]] };
    if (onThumb) {
      edgeL.stop();
      edgeR.stop();
    } else if (!reduce) {
      e.currentTarget.dataset.pressed = '';
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id || !d.onThumb) return;
    const x = localX(e);
    d.hist.push([e.timeStamp, x]);
    if (d.hist.length > 8) d.hist.shift();
    if (!d.live) {
      if (Math.abs(x - d.x0) < DEADZONE) return;
      d.live = true;
      d.offset = x - edgeL.get();
      d.w = edgeR.get() - edgeL.get();
      if (trackRef.current) trackRef.current.dataset.held = '';
    }
    const width = innerW.get();
    const l = x - d.offset;
    const maxL = width - d.w;
    if (reduce) {
      const c = clamp(l, 0, maxL);
      edgeL.set(c);
      edgeR.set(c + d.w);
    } else if (l < 0) {
      edgeL.set(0);
      edgeR.set(d.w - rubber(-l, d.w));
    } else if (l > maxL) {
      edgeR.set(width);
      edgeL.set(maxL + rubber(l - maxL, d.w));
    } else {
      edgeL.set(l);
      edgeR.set(l + d.w);
    }
  };

  const release = () => {
    const d = drag.current;
    drag.current = null;
    if (trackRef.current) delete trackRef.current.dataset.held;
    if (d) {
      const el = itemRefs.current[d.slot];
      if (el) delete el.dataset.pressed;
    }
    return d;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    release();
    const x = localX(e);
    if (!d.live) {
      if (Math.abs(x - d.x0) <= SLOP) {
        commit(d.slot);
        animateTo(d.slot);
      }
      return;
    }
    const v = velocityOf(d.hist, e.timeStamp);
    const flick = Math.abs(v) > FLICK;
    let to = nearestSlot(slots.current, (edgeL.get() + edgeR.get()) / 2 + project(v, glide));
    if (flick && to === committed.current) to = clamp(to + Math.sign(v), 0, list.length - 1);
    commit(to);
    animateTo(to);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    release();
    if (!d.live) return;
    animateTo(committed.current);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const last = list.length - 1;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(last, index + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    if (next === index) return;
    commit(next);
    animateTo(next);
    itemRefs.current[next]?.focus();
  };

  const preset = SIZES[size] || SIZES.md;

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-equal={equalSlots ? '' : undefined}
      data-draggable={draggable && !disabled ? '' : undefined}
      className={`rubber-segment${className ? ` ${className}` : ''}`}
      style={{
        ['--rs-track' as any]: trackColor,
        ['--rs-thumb' as any]: thumbColor,
        ['--rs-ink' as any]: textColor,
        ['--rs-ink-active' as any]: activeTextColor,
        ['--rs-radius' as any]: `${radius}px`,
        ['--rs-inset' as any]: `${inset}px`,
        ['--rs-thumb-radius' as any]: `${thumbRadius}px`,
        ['--rs-h' as any]: `${preset.height}px`,
        ['--rs-font' as any]: `${preset.font}px`,
        ['--rs-pad' as any]: `${preset.pad}px`,
        ['--rs-min' as any]: `${preset.min}px`,
        ['--rs-count' as any]: list.length,
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      {list.map((item, i) => (
        <button
          key={item.value}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          disabled={disabled}
          className="rubber-segment__item"
          onPointerDown={(e) => handlePointerDown(e, i)}
          onClick={() => {
            if (disabled) return;
            if (drag.current?.live) return;
            commit(i);
            animateTo(i);
          }}
          onKeyDown={handleKeyDown}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
      <motion.div
        className="rubber-segment__thumb"
        aria-hidden="true"
        style={{
          left: edgeL,
          width: thumbWidth,
        }}
      />
    </div>
  );
}
