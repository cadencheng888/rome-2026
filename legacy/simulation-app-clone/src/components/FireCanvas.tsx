import { useEffect, useRef, useState } from 'react';
import type { Grid } from '../fireEngine';

interface Props {
  grid: Grid;
  onCellClick: (x: number, y: number) => void;
  cellSize?: number;
  backgroundImageUrl?: string;
}

export function FireCanvas({
  grid,
  onCellClick,
  cellSize = 8,
  backgroundImageUrl,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);

  const w = grid[0]?.length ?? 0;
  const h = grid.length;
  const pixelW = w * cellSize;
  const pixelH = h * cellSize;

  useEffect(() => {
    if (!backgroundImageUrl) {
      setBgImage(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setBgImage(img);
    img.onerror = () => setBgImage(null);
    img.src = backgroundImageUrl;
  }, [backgroundImageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (bgImage) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bgImage, 0, 0, pixelW, pixelH);
      ctx.fillStyle = 'rgba(8, 12, 18, 0.25)';
      ctx.fillRect(0, 0, pixelW, pixelH);
    } else {
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(0, 0, pixelW, pixelH);
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = grid[y][x];

        if (cell.status === 'unburned') {
          if (!bgImage) {
            const fuelPct = cell.fuel / 100;
            const r = Math.round(120 - fuelPct * 80);
            const g = Math.round(130 - fuelPct * 20);
            const b = Math.round(70 - fuelPct * 20);
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          }
          continue;
        }

        let style = '';
        if (cell.status === 'firebreak') {
          style = bgImage ? 'rgba(20, 20, 24, 0.55)' : 'rgb(70, 70, 78)';
        } else if (cell.status === 'burning') {
          const heat = cell.heat;
          const r = 255;
          const g = Math.round(90 + heat * 140);
          const b = Math.round(20 + heat * 70);
          style = `rgb(${r}, ${g}, ${b})`;
        } else {
          style = bgImage ? 'rgba(28, 22, 20, 0.92)' : 'rgb(38, 30, 28)';
        }

        ctx.fillStyle = style;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);

        if (cell.status === 'burning' && cell.heat > 0.6) {
          ctx.fillStyle = `rgba(255, 220, 80, ${cell.heat * 0.5})`;
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }
    }
  }, [grid, cellSize, h, w, pixelW, pixelH, bgImage]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = Math.floor(((e.clientX - rect.left) * scaleX) / cellSize);
    const cy = Math.floor(((e.clientY - rect.top) * scaleY) / cellSize);
    onCellClick(cx, cy);
  }

  return (
    <canvas
      ref={canvasRef}
      width={pixelW}
      height={pixelH}
      onClick={handleClick}
      style={{
        display: 'block',
        cursor: 'crosshair',
        imageRendering: 'pixelated',
        width: '100%',
        height: '100%',
        objectFit: 'contain',
      }}
    />
  );
}
