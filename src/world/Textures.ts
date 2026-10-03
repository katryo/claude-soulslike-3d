import * as THREE from 'three';
import { fbm, rng } from '../core/math';

/** Procedural canvas textures (no image assets required). */

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, srgb = true): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noiseFill(ctx: CanvasRenderingContext2D, size: number, base: [number, number, number], amp: number, scale: number, seed: number): void {
  const img = ctx.createImageData(size, size);
  const r = rng(seed);
  const ox = r() * 100, oy = r() * 100;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable fbm by blending four samples.
      const u = x / size, v = y / size;
      const s = (a: number, b: number) => fbm(ox + a * scale, oy + b * scale, 5);
      const n =
        s(u, v) * (1 - u) * (1 - v) + s(u - 1, v) * u * (1 - v) + s(u, v - 1) * (1 - u) * v + s(u - 1, v - 1) * u * v;
      const grain = (r() - 0.5) * 0.15;
      const k = 1 + (n + grain) * amp;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, base[0] * k);
      img.data[i + 1] = Math.min(255, base[1] * k);
      img.data[i + 2] = Math.min(255, base[2] * k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

let grime: THREE.Texture | null = null;
export function getGrimeTexture(): THREE.Texture {
  if (!grime) grime = canvasTex(128, (ctx, s) => noiseFill(ctx, s, [235, 235, 235], 0.5, 6, 7));
  return grime;
}

let stone: THREE.Texture | null = null;
/** Stone block wall texture. */
export function getStoneTexture(): THREE.Texture {
  if (!stone) {
    stone = canvasTex(512, (ctx, s) => {
      noiseFill(ctx, s, [120, 116, 110], 0.55, 8, 3);
      const r = rng(11);
      const rows = 8;
      const h = s / rows;
      ctx.strokeStyle = 'rgba(20,18,16,0.85)';
      ctx.lineWidth = 3;
      for (let i = 0; i < rows; i++) {
        const y = i * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y);
        ctx.stroke();
        const off = (i % 2) * (s / 8);
        for (let x = off; x < s + 1; x += s / 4) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + h);
          ctx.stroke();
        }
        // Per-block tint variation
        for (let x = off - s / 4; x < s; x += s / 4) {
          ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,250,240'},${r() * 0.12})`;
          ctx.fillRect(x + 2, y + 2, s / 4 - 4, h - 4);
        }
      }
      // Moss streaks
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(60,80,40,${r() * 0.25})`;
        const x = r() * s, y = r() * s;
        ctx.fillRect(x, y, 4 + r() * 20, 2 + r() * 40);
      }
    });
  }
  return stone;
}

let stoneNormal: THREE.Texture | null = null;
export function getStoneBump(): THREE.Texture {
  if (!stoneNormal) {
    stoneNormal = canvasTex(512, (ctx, s) => {
      noiseFill(ctx, s, [150, 150, 150], 0.5, 12, 5);
      const rows = 8, h = s / rows;
      ctx.strokeStyle = 'rgb(10,10,10)';
      ctx.lineWidth = 6;
      for (let i = 0; i < rows; i++) {
        const y = i * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y);
        ctx.stroke();
        const off = (i % 2) * (s / 8);
        for (let x = off; x < s + 1; x += s / 4) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + h);
          ctx.stroke();
        }
      }
    }, false);
  }
  return stoneNormal;
}

let ground: THREE.Texture | null = null;
/** Muddy ground with dead grass and cobble hints. */
export function getGroundTexture(): THREE.Texture {
  if (!ground) {
    ground = canvasTex(512, (ctx, s) => {
      noiseFill(ctx, s, [78, 72, 60], 0.7, 5, 21);
      const r = rng(4);
      for (let i = 0; i < 2500; i++) {
        const x = r() * s, y = r() * s;
        ctx.strokeStyle = `rgba(${90 + r() * 40},${85 + r() * 30},${50 + r() * 20},${0.25 + r() * 0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (r() - 0.5) * 6, y - 3 - r() * 8);
        ctx.stroke();
      }
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = `rgba(${40 + r() * 30},${38 + r() * 25},${35 + r() * 20},${0.4 + r() * 0.4})`;
        ctx.beginPath();
        ctx.ellipse(r() * s, r() * s, 2 + r() * 6, 2 + r() * 5, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  return ground;
}

let flagstone: THREE.Texture | null = null;
/** Irregular flagstone floor for courtyard paths and the arena. */
export function getFlagstoneTexture(): THREE.Texture {
  if (!flagstone) {
    flagstone = canvasTex(512, (ctx, s) => {
      noiseFill(ctx, s, [105, 100, 94], 0.45, 10, 33);
      const r = rng(9);
      const n = 6;
      const cell = s / n;
      ctx.strokeStyle = 'rgba(25,22,20,0.9)';
      ctx.lineWidth = 4;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const jx = (r() - 0.5) * 10, jy = (r() - 0.5) * 10;
          ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,245,230'},${r() * 0.1})`;
          ctx.fillRect(i * cell + 3, j * cell + 3, cell - 6, cell - 6);
          ctx.strokeRect(i * cell + jx * 0.2, j * cell + jy * 0.2, cell, cell);
          if (r() < 0.35) {
            ctx.beginPath();
            ctx.moveTo(i * cell + r() * cell, j * cell);
            ctx.lineTo(i * cell + r() * cell, j * cell + cell);
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.lineWidth = 4;
          }
        }
      }
    });
  }
  return flagstone;
}

let bark: THREE.Texture | null = null;
export function getBarkTexture(): THREE.Texture {
  if (!bark) {
    bark = canvasTex(256, (ctx, s) => {
      noiseFill(ctx, s, [60, 50, 42], 0.5, 4, 77);
      const r = rng(5);
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = `rgba(15,10,8,${0.3 + r() * 0.5})`;
        ctx.lineWidth = 1 + r() * 3;
        const x = r() * s;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + (r() - 0.5) * 20, s * 0.3, x + (r() - 0.5) * 20, s * 0.6, x, s);
        ctx.stroke();
      }
    });
  }
  return bark;
}

/** Soft radial sprite used for particles and glows. */
let glow: THREE.Texture | null = null;
export function getGlowTexture(): THREE.Texture {
  if (!glow) {
    glow = canvasTex(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    glow.wrapS = glow.wrapT = THREE.ClampToEdgeWrapping;
  }
  return glow;
}
