import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { Route, MessageCircle } from 'lucide-react';
import SketchButton from '@/components/sketch/SketchButton';
import WashiTape from '@/components/sketch/WashiTape';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { say } from '@/lib/i18n';

/**
 * About §6 — Doodle canvas + CTA. A full-width paper-2 band where visitors
 * draw with a pencil cursor (ink stroke, 3px, slight wobble; strokes fade
 * out after 6s). The CTA card rises on enter; buttons stagger.
 * Canvas lives here only — no GSAP in this tree.
 */

/** Pencil SVG cursor (design.md §6 — About page doodle canvas only) */
const PENCIL_CURSOR =
  'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'26\' height=\'26\' viewBox=\'0 0 26 26\'><path d=\'M3 23l1.6-6.4L17 4l5 5L9.4 21.4z\' fill=\'%23FFC53D\' stroke=\'%232E2820\' stroke-width=\'2\' stroke-linejoin=\'round\'/><path d=\'M14 7l5 5\' stroke=\'%232E2820\' stroke-width=\'2\'/><path d=\'M3 23l2.6-.6-1-2.6z\' fill=\'%232E2820\'/></svg>") 3 23, crosshair';

interface Stroke {
  /** flat [x0, y0, x1, y1, …] */
  pts: number[];
  born: number;
}

const FADE_AFTER_MS = 5000;
const GONE_AFTER_MS = 6000;

function useDoodleCanvas(hasDrawn: () => void) {
  const bandRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const band = bandRef.current;
    const canvas = canvasRef.current;
    if (!band || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const strokes: Stroke[] = [];
    let drawing: Stroke | null = null;
    let raf = 0;
    let running = false;
    let visible = true;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { width, height } = band.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(band);

    const render = () => {
      const now = performance.now();
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (strokes[i] !== drawing && now - strokes[i].born > GONE_AFTER_MS) {
          strokes.splice(i, 1);
        }
      }
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (const s of strokes) {
        const age = now - s.born;
        const alpha =
          s === drawing || age < FADE_AFTER_MS
            ? 1
            : Math.max(0, 1 - (age - FADE_AFTER_MS) / (GONE_AFTER_MS - FADE_AFTER_MS));
        if (alpha <= 0) continue;
        ctx.strokeStyle = `rgba(46,40,32,${(alpha * 0.92).toFixed(3)})`;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const p = s.pts;
        if (p.length === 2) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], 1.6, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length - 2; i += 2) {
          const xc = (p[i] + p[i + 2]) / 2;
          const yc = (p[i + 1] + p[i + 3]) / 2;
          ctx.quadraticCurveTo(p[i], p[i + 1], xc, yc);
        }
        ctx.lineTo(p[p.length - 2], p[p.length - 1]);
        ctx.stroke();
      }
      if (strokes.length > 0 && visible) {
        raf = requestAnimationFrame(render);
      } else {
        running = false;
      }
    };
    const kick = () => {
      if (!running && visible) {
        running = true;
        raf = requestAnimationFrame(render);
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) kick();
    });
    io.observe(band);

    const pos = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      drawing = { pts: [x, y], born: performance.now() };
      strokes.push(drawing);
      hasDrawn();
      kick();
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const [x, y] = pos(e);
      const p = drawing.pts;
      const n = p.length;
      if (Math.hypot(x - p[n - 2], y - p[n - 1]) > 2.5) {
        // slight wobble so strokes read as pencil, not vector
        p.push(x + (Math.random() - 0.5) * 1.2, y + (Math.random() - 0.5) * 1.2);
        kick();
      }
    };
    const up = () => {
      drawing = null;
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { bandRef, canvasRef };
}

export default function DoodleCta() {
  const reduced = usePrefersReducedMotion();
  const [drawn, setDrawn] = useState(false);
  const { bandRef, canvasRef } = useDoodleCanvas(() => setDrawn(true));

  return (
    <section
      ref={bandRef}
      aria-label={say("Draw something and start")}
      className="relative h-[540px] overflow-hidden border-y-2 border-dashed border-pencil bg-paper-2"
    >
      {/* drawing surface */}
      <canvas
        ref={canvasRef}
        aria-label={say("Doodle canvas — draw with your pointer")}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: PENCIL_CURSOR,
          touchAction: 'none',
        }}
      />

      {/* hint until the first stroke */}
      {!drawn && (
        <p className="micro pointer-events-none absolute right-8 top-5 rotate-2 animate-pulse text-ink-faint">
          
          {say("draw something!")}
        </p>
      )}

      {/* CTA card */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto relative w-full max-w-lg rounded-wobble-2 border-2 border-ink bg-paper-3 p-8 pt-10 text-center shadow-offset"
        >
          <WashiTape rotate={-4} className="left-10" />
          <WashiTape rotate={3} color="blue" className="left-auto right-10" />
          <h2 className="font-display text-[44px] font-bold leading-none text-ink">
            
            {say("Ready to fill the first page?")}
          </h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <motion.span
              initial={reduced ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: reduced ? 0 : 0.15 }}
            >
              <Link to="/lesson-path">
                <SketchButton variant="accent" size="lg">
                  <Route className="h-5 w-5" />  {say("Open the Lesson Path")}
                </SketchButton>
              </Link>
            </motion.span>
            <motion.span
              initial={reduced ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: reduced ? 0 : 0.25 }}
            >
              <Link to="/chat">
                <SketchButton variant="secondary" size="lg">
                  <MessageCircle className="h-5 w-5" />  {say("Ask the Coach")}
                </SketchButton>
              </Link>
            </motion.span>
          </div>
          <motion.p
            initial={reduced ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: reduced ? 0 : 0.35 }}
            className="mt-4"
          >
            <Link to="/repos" className="squiggle text-sm font-bold">
              
              {say("or browse the shelf")}
            </Link>
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
