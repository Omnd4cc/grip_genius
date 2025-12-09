/**
 * 岩点检测 Pipeline
 * 
 * Phase 1: 多帧采样 → YOLO 检测 → 融合去重 → 颜色聚类
 * 
 * 这个模块负责从视频中提取完整的岩点列表和线路分组
 * 结果会被缓存，供后续姿态分析复用
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
  topHold?: DetectedHold;    // Y 最小
  startHold?: DetectedHold;  // Y 最大
}

export interface HoldDetectionResult {
  allHolds: DetectedHold[];
  routes: Map<string, Route>;
  frameWidth: number;
  frameHeight: number;
}

// ============ Mock YOLO 检测器 ============

/**
 * Mock YOLO 模型调用
 * TODO: 替换为真实的 ONNX Runtime 调用
 */
export async function mockYoloDetect(
  imageData: ImageData
): Promise<DetectedHold[]> {
  // 模拟检测结果 - 实际使用时替换为 ONNX 推理
  // 这里返回一些模拟的岩点位置
  
  const { width, height } = imageData;
  
  // 模拟检测到的岩点 (随机生成一些点，实际会被真实模型替换)
  const mockHolds: DetectedHold[] = [
    { id: 'h1', x: width * 0.3, y: height * 0.2, width: 40, height: 40, confidence: 0.95 },
    { id: 'h2', x: width * 0.5, y: height * 0.15, width: 35, height: 35, confidence: 0.92 },  // Top
    { id: 'h3', x: width * 0.4, y: height * 0.35, width: 45, height: 40, confidence: 0.88 },
    { id: 'h4', x: width * 0.6, y: height * 0.45, width: 38, height: 38, confidence: 0.91 },
    { id: 'h5', x: width * 0.35, y: height * 0.55, width: 42, height: 42, confidence: 0.89 },
    { id: 'h6', x: width * 0.55, y: height * 0.65, width: 40, height: 40, confidence: 0.93 },
    { id: 'h7', x: width * 0.45, y: height * 0.75, width: 50, height: 45, confidence: 0.90 },  // Start
    { id: 'h8', x: width * 0.7, y: height * 0.3, width: 36, height: 36, confidence: 0.85 },   // 另一条线路
    { id: 'h9', x: width * 0.75, y: height * 0.5, width: 40, height: 40, confidence: 0.87 },
  ];
  
  // 模拟异步延迟
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return mockHolds;
}

// ============ 帧采样 ============

/**
 * 从视频中采样多帧
 */
export async function sampleFrames(
  video: HTMLVideoElement,
  numFrames: number = 5
): Promise<ImageData[]> {
  const frames: ImageData[] = [];
  const duration = video.duration;
  
  // 采样时间点: 开头(5%), 1/4, 1/2, 3/4, 结尾(95%)
  const samplePoints = [0.05, 0.25, 0.5, 0.75, 0.95];
  
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  
  for (const point of samplePoints.slice(0, numFrames)) {
    const time = duration * point;
    
    // Seek 到指定时间
    video.currentTime = time;
    await new Promise<void>(resolve => {
      video.onseeked = () => resolve();
    });
    
    // 绘制帧
    ctx.drawImage(video, 0, 0);
    frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }
  
  return frames;
}

// ============ 结果融合 ============

/**
 * 融合多帧检测结果，去重
 */
export function mergeDetections(
  frameDetections: DetectedHold[][],
  mergeThreshold: number = 30  // 像素距离阈值
): DetectedHold[] {
  const merged: DetectedHold[] = [];
  let idCounter = 1;
  
  for (const frameHolds of frameDetections) {
    for (const hold of frameHolds) {
      // 检查是否与已有岩点重合
      const existing = merged.find(m => 
        Math.abs(m.x - hold.x) < mergeThreshold &&
        Math.abs(m.y - hold.y) < mergeThreshold
      );
      
      if (existing) {
        // 更新置信度 (取较高的)
        if (hold.confidence > existing.confidence) {
          existing.confidence = hold.confidence;
          existing.x = hold.x;
          existing.y = hold.y;
          existing.width = hold.width;
          existing.height = hold.height;
        }
      } else {
        // 新岩点
        merged.push({
          ...hold,
          id: `G${idCounter++}`
        });
      }
    }
  }
  
  return merged;
}

// ============ 颜色提取 ============

/**
 * RGB 转 HSV
 */
function rgbToHsv(r: number, g: number, b: number): HSVColor {
  r /= 255; g /= 255; b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  
  if (max !== min) {
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
 * 从图像区域提取主色调
 */
export function extractDominantColor(
  imageData: ImageData,
  hold: DetectedHold
): HSVColor {
  const { data, width } = imageData;
  
  // 采样岩点区域中心的像素
  const centerX = Math.floor(hold.x + hold.width / 2);
  const centerY = Math.floor(hold.y + hold.height / 2);
  const sampleRadius = Math.min(hold.width, hold.height) / 3;
  
  let totalR = 0, totalG = 0, totalB = 0, count = 0;
  
  for (let dy = -sampleRadius; dy <= sampleRadius; dy++) {
    for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
      const x = Math.floor(centerX + dx);
      const y = Math.floor(centerY + dy);
      
      if (x >= 0 && x < width && y >= 0 && y < imageData.height) {
        const idx = (y * width + x) * 4;
        totalR += data[idx];
        totalG += data[idx + 1];
        totalB += data[idx + 2];
        count++;
      }
    }
  }
  
  if (count === 0) {
    return { h: 0, s: 0, v: 0 };
  }
  
  return rgbToHsv(totalR / count, totalG / count, totalB / count);
}

/**
 * 为所有岩点提取颜色
 */
export function extractAllColors(
  imageData: ImageData,
  holds: DetectedHold[]
): void {
  for (const hold of holds) {
    hold.color = extractDominantColor(imageData, hold);
    hold.colorName = hsvToColorName(hold.color);
  }
}

/**
 * HSV 转颜色名称
 */
function hsvToColorName(hsv: HSVColor): string {
  const { h, s, v } = hsv;
  
  // 低饱和度 = 灰/白/黑
  if (s < 0.15) {
    if (v > 0.8) return 'white';
    if (v < 0.3) return 'black';
    return 'gray';
  }
  
  // 按色相分类
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 75) return 'yellow';
  if (h < 150) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 285) return 'purple';
  if (h < 345) return 'pink';
  
  return 'unknown';
}

// ============ 颜色聚类 ============

/**
 * 按颜色对岩点进行聚类，形成线路
 */
export function clusterByColor(holds: DetectedHold[]): Map<string, Route> {
  const routes = new Map<string, Route>();
  
  for (const hold of holds) {
    const colorName = hold.colorName || 'unknown';
    
    if (!routes.has(colorName)) {
      routes.set(colorName, {
        color: colorName,
        colorHSV: hold.color || { h: 0, s: 0, v: 0 },
        holds: []
      });
    }
    
    routes.get(colorName)!.holds.push(hold);
  }
  
  // 为每条线路确定 Top 和 Start
  for (const route of routes.values()) {
    if (route.holds.length > 0) {
      // 按 Y 坐标排序 (Y 小 = 位置高)
      const sorted = [...route.holds].sort((a, b) => a.y - b.y);
      route.topHold = sorted[0];
      route.startHold = sorted[sorted.length - 1];
    }
  }
  
  return routes;
}

// ============ 主 Pipeline ============

/**
 * 完整的岩点检测 Pipeline
 * 
 * @param video 视频元素
 * @returns 检测结果 (岩点列表 + 线路分组)
 */
export async function detectHoldsFromVideo(
  video: HTMLVideoElement
): Promise<HoldDetectionResult> {
  console.log('[HoldPipeline] 开始岩点检测...');
  
  // Step 1: 采样多帧
  console.log('[HoldPipeline] Step 1: 采样视频帧...');
  const frames = await sampleFrames(video, 5);
  console.log(`[HoldPipeline] 采样了 ${frames.length} 帧`);
  
  // Step 2: 对每帧进行 YOLO 检测
  console.log('[HoldPipeline] Step 2: 岩点检测 (YOLO)...');
  const frameDetections: DetectedHold[][] = [];
  for (let i = 0; i < frames.length; i++) {
    const detections = await mockYoloDetect(frames[i]);
    frameDetections.push(detections);
    console.log(`[HoldPipeline]   帧 ${i + 1}: 检测到 ${detections.length} 个岩点`);
  }
  
  // Step 3: 融合去重
  console.log('[HoldPipeline] Step 3: 融合多帧结果...');
  const mergedHolds = mergeDetections(frameDetections);
  console.log(`[HoldPipeline] 融合后共 ${mergedHolds.length} 个独立岩点`);
  
  // Step 4: 颜色提取 (使用第一帧，因为光照最稳定)
  console.log('[HoldPipeline] Step 4: 提取岩点颜色...');
  extractAllColors(frames[0], mergedHolds);
  
  // Step 5: 颜色聚类 → 线路
  console.log('[HoldPipeline] Step 5: 颜色聚类 → 识别线路...');
  const routes = clusterByColor(mergedHolds);
  console.log(`[HoldPipeline] 识别出 ${routes.size} 条线路:`);
  for (const [color, route] of routes) {
    console.log(`[HoldPipeline]   - ${color}: ${route.holds.length} 个岩点, Top=${route.topHold?.id}, Start=${route.startHold?.id}`);
  }
  
  console.log('[HoldPipeline] ✅ 岩点检测完成!');
  
  return {
    allHolds: mergedHolds,
    routes,
    frameWidth: video.videoWidth,
    frameHeight: video.videoHeight
  };
}

// ============ 转换为旧格式 (兼容现有代码) ============

export function toHoldArray(result: HoldDetectionResult): Hold[] {
  return result.allHolds.map(h => ({
    id: h.id,
    x: h.x + h.width / 2,  // 中心点
    y: h.y + h.height / 2,
    radius: Math.max(h.width, h.height) / 2,
    color: [h.color?.h || 0, h.color?.s || 0, h.color?.v || 0] as [number, number, number]
  }));
}

