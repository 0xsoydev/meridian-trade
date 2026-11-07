"use client";

/**
 * Adapted from Magic UI's Animated Beam (MIT).
 * https://magicui.design/docs/components/animated-beam
 */

import { motion, useReducedMotion } from "motion/react";
import { type RefObject, useEffect, useId, useState } from "react";

export function AnimatedBeam({
  containerRef,
  fromRef,
  toRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
}) {
  const id = useId();
  const reduced = useReducedMotion();
  const [path, setPath] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    const from = fromRef.current;
    const to = toRef.current;
    if (!container || !from || !to) return;
    const update = () => {
      const box = container.getBoundingClientRect();
      const scale = box.width / container.offsetWidth || 1;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const startX = (a.right - box.left) / scale;
      const startY = (a.top + a.height / 2 - box.top) / scale;
      const endX = (b.left - box.left) / scale;
      const endY = (b.top + b.height / 2 - box.top) / scale;
      const midX = (startX + endX) / 2;
      setSize({ width: container.offsetWidth, height: container.offsetHeight });
      setPath(`M ${startX},${startY} C ${midX},${startY} ${midX},${endY} ${endX},${endY}`);
    };
    const observer = new ResizeObserver(update);
    for (const element of [container, from, to]) observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [containerRef, fromRef, toRef]);

  return (
    <svg
      aria-hidden
      fill="none"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      className="pointer-events-none absolute left-0 top-0"
    >
      <path d={path} stroke="#CECECE" strokeWidth={1.25} strokeLinecap="round" />
      {reduced ? null : (
        <>
          <path d={path} stroke={`url(#${id})`} strokeWidth={1.75} strokeLinecap="round" />
          <defs>
            <motion.linearGradient
              id={id}
              gradientUnits="userSpaceOnUse"
              initial={{ x1: "0%", x2: "0%", y1: "0%", y2: "0%" }}
              animate={{ x1: ["10%", "110%"], x2: ["0%", "100%"], y1: ["0%", "0%"], y2: ["0%", "0%"] }}
              transition={{ duration: 3.5, ease: "linear", repeat: Infinity, repeatDelay: 0.6 }}
            >
              <stop stopColor="#1743FF" stopOpacity="0" />
              <stop stopColor="#1743FF" />
              <stop offset="32.5%" stopColor="#1743FF" />
              <stop offset="100%" stopColor="#1743FF" stopOpacity="0" />
            </motion.linearGradient>
          </defs>
        </>
      )}
    </svg>
  );
}
