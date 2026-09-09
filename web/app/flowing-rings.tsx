"use client";

import { useEffect, useRef } from "react";

export default function FlowingRings() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1, height = 1, scale = 1, frame = 0, last = 0, time = 0;
    let visible = true;
    let pointerX = 0, pointerY = 0, x = 0, y = 0;
    const text = "WORD FORMAT / THESIS STRUCTURE / DOCX / ";
    let layers: { image: HTMLCanvasElement; radius: number; extent: number; phase: number; speed: number; opacity: number }[] = [];

    function prepareLayers() {
      const size = Math.min(width, height);
      const outer = Math.hypot(width, height) * 0.64;
      const inner = size * 0.065;
      const count = Math.min(28, Math.max(18, Math.round(outer / 19)));
      layers = Array.from({ length: count }, (_, index) => {
        const depth = index / (count - 1);
        const radius = inner + (outer - inner) * Math.pow(depth, 1.25);
        const font = 6 + 7 * Math.sqrt(depth);
        const repeats = Math.max(1, Math.round(2 * Math.PI * radius / (text.length * font * 0.64)));
        const line = text.repeat(repeats);
        const extent = radius + font * 1.5;
        const image = document.createElement("canvas");
        const resolution = Math.min(scale, 1.5);
        image.width = image.height = Math.ceil(extent * 2 * resolution);
        const ink = image.getContext("2d")!;
        ink.scale(resolution, resolution);
        ink.translate(extent, extent);
        ink.font = `${font}px Consolas, monospace`;
        ink.textAlign = "center";
        ink.textBaseline = "middle";
        // Keep glyph positions fixed. Recounting letters during motion caused visible jumps.
        for (let letter = 0; letter < line.length; letter++) {
          const angle = letter / line.length * Math.PI * 2;
          const softness = 0.68 + 0.32 * Math.sin(angle * 2 + depth * 4) ** 2;
          ink.fillStyle = `rgba(238,237,226,${softness})`;
          ink.save();
          ink.rotate(angle);
          ink.translate(radius, 0);
          ink.rotate(Math.PI / 2);
          ink.fillText(line[letter], 0, 0);
          ink.restore();
        }
        return { image, radius, extent, phase: index * 0.47, speed: 0.026 + 0.018 * (1 - depth), opacity: 0.24 + Math.sqrt(depth) * 0.62 };
      });
    }

    function draw() {
      if (!context) return;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.fillStyle = "#202020";
      context.fillRect(0, 0, width, height);
      const size = Math.min(width, height);
      const centerX = width * 0.52 + x * size * 0.018;
      const centerY = height * 0.51 + y * size * 0.018;
      for (const layer of layers) {
        const wave = time * 0.32 - layer.radius / size * 2.4;
        const breathe = 1 + Math.sin(wave) * 0.012;
        context.save();
        context.globalAlpha = layer.opacity;
        context.translate(centerX + Math.sin(wave) * 1.5, centerY + Math.cos(wave) * 1.5);
        context.rotate(layer.phase + time * layer.speed + Math.sin(wave) * 0.012);
        context.scale(breathe, breathe);
        context.drawImage(layer.image, -layer.extent, -layer.extent, layer.extent * 2, layer.extent * 2);
        context.restore();
      }
    }

    function tick(now: number) {
      frame = 0;
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      time += dt;
      const easing = 1 - Math.exp(-dt * 2.4);
      x += (pointerX - x) * easing;
      y += (pointerY - y) * easing;
      draw();
      if (visible && !document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
    }
    function resume() {
      cancelAnimationFrame(frame);
      last = 0;
      draw();
      if (visible && !document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
    }
    const resize = new ResizeObserver(() => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      prepareLayers();
      resume();
    });
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    function move(event: PointerEvent) {
      const bounds = canvas!.getBoundingClientRect();
      pointerX = (event.clientX - bounds.left) / width * 2 - 1;
      pointerY = (event.clientY - bounds.top) / height * 2 - 1;
    }
    function leave() { pointerX = 0; pointerY = 0; }
    resize.observe(canvas);
    observer.observe(canvas);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    reduced.addEventListener("change", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      reduced.removeEventListener("change", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  return <canvas ref={ref} className="flowing-rings" role="img" aria-label="缓慢流动、轻柔起伏的黑白文字环" />;
}
