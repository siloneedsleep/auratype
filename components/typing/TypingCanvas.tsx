'use client';

import React, { useEffect, useRef } from 'react';
import { ParticleSpawnSignal } from '../../store/useTypingStore';

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  color: string;
  gravity: number;
}

interface ShockwaveRing {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
}

const MAX_PARTICLES = 120;
const ERROR_COLORS = ['#EF4444', '#F87171', '#FB923C', '#FCA5A5'];
const FINALE_COLORS = ['#38BDF8', '#818CF8', '#FBBF24', '#34D399'];

interface TypingCanvasProps {
  signal: ParticleSpawnSignal | null;
  getCharCoordinates: (charIndex: number) => { x: number; y: number } | null;
  enabled: boolean;
}

export default function TypingCanvas({
  signal,
  getCharCoordinates,
  enabled,
}: TypingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poolRef = useRef<Particle[]>([]);
  const ringsRef = useRef<ShockwaveRing[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const lastSignalIdRef = useRef<number>(0);

  // Initialize fixed particle pool once
  useEffect(() => {
    const pool: Particle[] = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      pool.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 3,
        alpha: 0,
        decay: 0.03,
        color: '#EF4444',
        gravity: 0.25,
      });
    }
    poolRef.current = pool;
    ringsRef.current = [
      {
        active: false,
        x: 0,
        y: 0,
        radius: 0,
        maxRadius: 280,
        alpha: 0,
        color: '#38BDF8',
      },
      {
        active: false,
        x: 0,
        y: 0,
        radius: 0,
        maxRadius: 420,
        alpha: 0,
        color: '#FBBF24',
      },
    ];
  }, []);

  // Resize canvas with DPR capped at 2 (Section 11)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    if (canvas.parentElement) {
      ro.observe(canvas.parentElement);
    }

    return () => {
      ro.disconnect();
    };
  }, []);

  // Start or continue single animation loop only while particles/rings are active
  const startLoopIfNeeded = React.useCallback(() => {
    if (rafIdRef.current !== null) return;

    const renderFrame = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        rafIdRef.current = null;
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        rafIdRef.current = null;
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafIdRef.current = null;
        return;
      }

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      let anyActive = false;

      // Update & draw particles from pool
      const pool = poolRef.current;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.active) continue;

        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.alpha -= p.decay;

        if (p.alpha <= 0.01) {
          p.active = false;
          continue;
        }

        anyActive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Update & draw shockwave rings
      const rings = ringsRef.current;
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        if (!r.active) continue;

        r.radius += (r.maxRadius - r.radius) * 0.11 + 2.5;
        r.alpha *= 0.92;

        if (r.alpha <= 0.02 || r.radius >= r.maxRadius) {
          r.active = false;
          continue;
        }

        anyActive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, r.alpha);
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (anyActive) {
        rafIdRef.current = window.requestAnimationFrame(renderFrame);
      } else {
        rafIdRef.current = null;
      }
    };

    rafIdRef.current = window.requestAnimationFrame(renderFrame);
  }, []);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (enabled) return;
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = null;
    poolRef.current.forEach((p) => {
      p.active = false;
    });
    ringsRef.current.forEach((r) => {
      r.active = false;
    });
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, [enabled]);

  // Spawn particles when signal updates
  useEffect(() => {
    if (!enabled || !signal || signal.id === lastSignalIdRef.current) return;
    lastSignalIdRef.current = signal.id;

    const coords = getCharCoordinates(signal.charIndex);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fallbackX = canvas.width / dpr / 2;
    const fallbackY = canvas.height / dpr / 2;
    const originX = coords ? coords.x : fallbackX;
    const originY = coords ? coords.y : fallbackY;

    const pool = poolRef.current;
    const spawnParticle = (opts: Omit<Particle, 'active'>) => {
      for (let i = 0; i < pool.length; i++) {
        if (!pool[i].active) {
          pool[i] = { active: true, ...opts };
          return;
        }
      }
    };

    if (signal.type === 'error_debris') {
      // Spawn 4 debris particles falling with gravity (Module 3)
      const count = 4;
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
        const speed = 1.6 + Math.random() * 2.8;
        spawnParticle({
          x: originX + (Math.random() - 0.5) * 8,
          y: originY + 8,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          size: 2.2 + Math.random() * 1.8,
          alpha: 0.95,
          decay: 0.032 + Math.random() * 0.015,
          color: ERROR_COLORS[i % ERROR_COLORS.length],
          gravity: 0.28,
        });
      }
    } else if (signal.type === 'finale_shockwave') {
      // Grand finale shockwave ring + luminous sparks
      const rings = ringsRef.current;
      if (rings[0]) {
        rings[0] = {
          active: true,
          x: originX,
          y: originY,
          radius: 8,
          maxRadius: 340,
          alpha: 0.85,
          color: '#38BDF8',
        };
      }
      if (rings[1]) {
        rings[1] = {
          active: true,
          x: originX,
          y: originY,
          radius: 4,
          maxRadius: 220,
          alpha: 0.7,
          color: '#FBBF24',
        };
      }

      for (let i = 0; i < 28; i++) {
        const angle = (Math.PI * 2 * i) / 28 + (Math.random() - 0.5) * 0.2;
        const speed = 2.2 + Math.random() * 4.5;
        spawnParticle({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 2.5 + Math.random() * 2,
          alpha: 1,
          decay: 0.02 + Math.random() * 0.012,
          color: FINALE_COLORS[i % FINALE_COLORS.length],
          gravity: 0.06,
        });
      }
    }

    startLoopIfNeeded();
  }, [enabled, signal, getCharCoordinates, startLoopIfNeeded]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="typing-fx-canvas"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
    />
  );
}
