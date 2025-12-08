import { Point, Keypoint } from '../types';

export function distance(p1: Point, p2: Point): number {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

export function angle(p1: Point, p2: Point, p3: Point): number {
  // Angle at p2
  const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
  const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
  
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  
  if (mag1 === 0 || mag2 === 0) return 0;
  
  const rad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
  return (rad * 180) / Math.PI;
}

export function normalizePoint(p: Point, width: number, height: number): Point {
  return { x: p.x / width, y: p.y / height };
}

