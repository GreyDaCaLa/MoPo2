import * as THREE from 'three';
import { GROUPS } from '@mopo/shared';

const PX = 256; // pixels per world unit
const cache = new Map();

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

const ICONS = {
  start: '➜', jail: '⛓', rest: '☕', gotojail: '🚨',
  transit: '🚋', utility: '⚡', tax: '💰',
  fortune: '✦', cityhall: '🏛',
};

/** Draws a space onto a canvas. Canvas "top" is the tile's inner edge. */
export function tileTexture(space, w, h) {
  if (cache.has(space.index)) return cache.get(space.index);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * PX);
  canvas.height = Math.round(h * PX);
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#f5efe0';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1d1d1d';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  const corner = space.index % 10 === 0;
  ctx.fillStyle = '#1d1d1d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let y = 0;
  if (space.type === 'street') {
    const band = H * 0.22;
    ctx.fillStyle = GROUPS[space.group].color;
    ctx.fillRect(0, 0, W, band);
    ctx.strokeRect(2, 2, W - 4, band);
    y = band + 30;
  } else {
    const icon = ICONS[space.type] || ICONS[space.deck];
    if (icon) {
      ctx.font = `${corner ? 120 : 72}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.fillText(icon, W / 2, corner ? H * 0.62 : H * 0.48);
    }
    y = corner ? H * 0.2 : 50;
  }

  ctx.fillStyle = '#1d1d1d';
  ctx.font = `bold ${corner ? 44 : 30}px system-ui, sans-serif`;
  const lines = wrapText(ctx, space.name.toUpperCase(), W - 24);
  lines.forEach((l, n) => ctx.fillText(l, W / 2, y + n * 34));

  const price = space.price ?? space.amount;
  if (price != null) {
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.fillText(space.type === 'tax' ? `PAY $${price}` : `$${price}`, W / 2, H - 36);
  }
  if (space.type === 'start') {
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillText('COLLECT $200', W / 2, H - 40);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(space.index, tex);
  return tex;
}
