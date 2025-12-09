/**
 * 岩点检测器
 * 
 * Phase 1: 从视频中检测所有岩点，按颜色分组成线路
 * 
 * 流程:
 * 1. 抽取关键帧 (避免人遮挡)
 * 2. YOLO 检测岩点
 * 3. 多帧融合去重
 * 4. 颜色提取 + 聚类
 * 5. 输出线路分组 (自动标记 Top/Start)
 */

import { Hold } from '../types';

// ============ 类型定义 ============

export interface DetectedHold {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  color?: HSVColor;
  colorName?: string;
}

export interface HSVColor {
  h: number;  // 0-360
  s: number;  // 0-1
  v: number;  // 0-1
}

export interface Route {
  color: string;
  colorHSV: HSVColor;
  holds: DetectedHold[];
  topHold?: DetectedHold;
  startHold?: DetectedHold;
}

export interface HoldDetectionResult {
  allHolds: DetectedHold[];
  routes: Route[];
  frameWidth: number;
  frameHeight: number;
}

// ============ YOLO 检测 (Mock) ============

/**
 * Mock YOLO 模型调用
 * TODO: 替换为真实的 ONNX Runtime 调用
 */
async function yoloDetect(imageData: ImageData): Promise<DetectedHold[]> {
  const { width, height } = imageData;
  
  // Mock 数据 - 模拟一条灰色线路和一条黄色线路
  await new Promise(r => setTimeout(r, 50));
  
  return [
    // 灰色线路
    { id: '', x: width * 0.3, y: height * 0.15, width: 40, height: 40, confidence: 0.95 },
    { id: '', x: width * 0.35, y: height * 0.35, width: 45, height: 40, confidence: 0.92 },
    { id: '', x: width * 0.28, y: height * 0.50, width: 42, height: 42, confidence: 0.90 },
    { id: '', x: width * 0.40, y: height * 0.65, width: 38, height: 38, confidence: 0.88 },
    { id: '', x: width * 0.32, y: height * 0.80, width: 50, height: 45, confidence: 0.93 },
    // 黄色线路
    { id: '', x: width * 0.65, y: height * 0.12, width: 35, height: 35, confidence: 0.91 },
    { id: '', x: width * 0.60, y: height * 0.40, width: 40, height: 40, confidence: 0.89 },
    { id: '', x: width * 0.70, y: height * 0.60, width: 45, height: 42, confidence: 0.87 },
    { id: '', x: width * 0.62, y: height * 0.85, width: 48, height: 45, confidence: 0.94 },
  ];
}

// ============ 核心函数 ============

/**
 * 从视频中采样关键帧
 */
async function sampleFrames(video: HTMLVideoElement, numFrames = 5): Promise<ImageData[]> {
  const frames: ImageData[] = [];
  const duration = video.duration;
  const points = [0.05, 0.25, 0.5, 0.75, 0.95].slice(0, numFrames);
  
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  
  for (const p of points) {
    video.currentTime = duration * p;
    await new Promise<void>(r => { video.onseeked = () => r(); });
    ctx.drawImage(video, 0, 0);
    frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }
  
  return frames;
}

/**
 * 融合多帧检测结果
 */
function mergeDetections(frameDetections: DetectedHold[][], threshold = 30): DetectedHold[] {
  const merged: DetectedHold[] = [];
  let id = 1;
  
  for (const holds of frameDetections) {
    for (const hold of holds) {
      const existing = merged.find(m =>
        Math.abs(m.x - hold.x) < threshold && Math.abs(m.y - hold.y) < threshold
      );
      
      if (existing) {
        if (hold.confidence > existing.confidence) {
          Object.assign(existing, hold);
        }
      } else {
        merged.push({ ...hold, id: `G${id++}` });
      }
    }
  }
  
  return merged;
}

/**
 * RGB 转 HSV
 */
function rgbToHsv(r: number, g: number, b: number): HSVColor {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  
  if (d !== 0) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s, v };
}

/**
 * HSV 转颜色名
 */
function hsvToColorName(hsv: HSVColor): string {
  const { h, s, v } = hsv;
  if (s < 0.15) return v > 0.8 ? 'white' : v < 0.3 ? 'black' : 'gray';
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 75) return 'yellow';
  if (h < 150) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 285) return 'purple';
  return 'pink';
}

/**
 * 提取岩点颜色
 */
function extractColors(imageData: ImageData, holds: DetectedHold[]): void {
  const { data, width } = imageData;
  
  for (const hold of holds) {
    const cx = Math.floor(hold.x + hold.width / 2);
    const cy = Math.floor(hold.y + hold.height / 2);
    const r = Math.floor(Math.min(hold.width, hold.height) / 3);
    
    let tr = 0, tg = 0, tb = 0, count = 0;
    
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < width && y >= 0 && y < imageData.height) {
          const idx = (y * width + x) * 4;
          tr += data[idx]; tg += data[idx + 1]; tb += data[idx + 2];
          count++;
        }
      }
    }
    
    if (count > 0) {
      hold.color = rgbToHsv(tr / count, tg / count, tb / count);
      hold.colorName = hsvToColorName(hold.color);
    }
  }
}

/**
 * 按颜色聚类成线路
 */
function clusterByColor(holds: DetectedHold[]): Route[] {
  const routeMap = new Map<string, Route>();
  
  for (const hold of holds) {
    const color = hold.colorName || 'unknown';
    if (!routeMap.has(color)) {
      routeMap.set(color, {
        color,
        colorHSV: hold.color || { h: 0, s: 0, v: 0 },
        holds: []
      });
    }
    routeMap.get(color)!.holds.push(hold);
  }
  
  // 确定每条线路的 Top 和 Start
  const routes = Array.from(routeMap.values());
  for (const route of routes) {
    if (route.holds.length > 0) {
      const sorted = [...route.holds].sort((a, b) => a.y - b.y);
      route.topHold = sorted[0];
      route.startHold = sorted[sorted.length - 1];
    }
  }
  
  return routes;
}

// ============ 主入口 ============

/**
 * 完整的岩点检测 Pipeline
 */
export async function detectHolds(video: HTMLVideoElement): Promise<HoldDetectionResult> {
  console.log('[HoldDetector] 开始检测...');
  
  // Step 1: 采样帧
  const frames = await sampleFrames(video, 5);
  console.log(`[HoldDetector] 采样 ${frames.length} 帧`);
  
  // Step 2: 多帧检测
  const detections: DetectedHold[][] = [];
  for (const frame of frames) {
    detections.push(await yoloDetect(frame));
  }
  
  // Step 3: 融合去重
  const merged = mergeDetections(detections);
  console.log(`[HoldDetector] 检测到 ${merged.length} 个岩点`);
  
  // Step 4: 颜色提取
  extractColors(frames[Math.floor(frames.length / 2)], merged);
  
  // Step 5: 聚类成线路
  const routes = clusterByColor(merged);
  console.log(`[HoldDetector] 识别 ${routes.length} 条线路`);
  
  return {
    allHolds: merged,
    routes,
    frameWidth: video.videoWidth,
    frameHeight: video.videoHeight
  };
}

/**
 * 转换为旧版 Hold 格式 (兼容)
 */
export function toHoldArray(result: HoldDetectionResult): Hold[] {
  return result.allHolds.map(h => ({
    id: h.id,
    x: h.x + h.width / 2,
    y: h.y + h.height / 2,
    radius: Math.max(h.width, h.height) / 2,
    color: [h.color?.h || 0, h.color?.s || 0, h.color?.v || 0] as [number, number, number]
  }));
}
