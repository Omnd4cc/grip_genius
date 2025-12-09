/**
 * 岩点检测器 - 多帧融合 Pipeline
 * 
 * 流程：
 * 1. 从视频抽取关键帧
 * 2. 对每帧调用 YOLO 检测岩点
 * 3. 多帧结果对齐融合
 * 4. 颜色提取 + 聚类分组
 */

import { Hold } from '../types';

// ==================== 类型定义 ====================

interface DetectionResult {
  x: number;      // 中心点 x
  y: number;      // 中心点 y
  width: number;
  height: number;
  confidence: number;
  class: string;  // "hold"
}

interface HoldWithColor extends DetectionResult {
  color: { h: number; s: number; v: number };
  colorName: string;
}

interface RouteGroup {
  colorName: string;
  colorHSV: { h: number; s: number; v: number };
  holds: Hold[];
  topHold: Hold | null;
  startHold: Hold | null;
}

// ==================== Mock YOLO 检测 ====================

/**
 * Mock YOLO 模型调用
 * TODO: 替换为真实的 ONNX Runtime 调用
 */
async function mockYoloDetect(
  _imageData: ImageData
): Promise<DetectionResult[]> {
  // 模拟检测结果 - 实际使用时替换为 ONNX 推理
  // 这里返回一些模拟的岩点位置
  
  // 模拟处理延迟
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // 返回空数组，实际实现时这里是真实检测结果
  // 真实实现参考:
  // const session = await ort.InferenceSession.create('/models/hold_detector.onnx');
  // const results = await session.run({ images: inputTensor });
  // return parseYoloOutput(results);
  
  return [];
}

// ==================== 关键帧抽取 ====================

export async function extractKeyFrames(
  video: HTMLVideoElement,
  numFrames: number = 5
): Promise<ImageData[]> {
  const frames: ImageData[] = [];
  const duration = video.duration;
  
  // 创建离屏 canvas
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  
  // 计算抽帧时间点: 开头、1/4、中间、3/4、结尾前一点
  const timePoints = [
    0.5,                          // 开头（跳过前0.5秒）
    duration * 0.25,
    duration * 0.5,
    duration * 0.75,
    Math.max(0, duration - 0.5)   // 结尾前
  ].slice(0, numFrames);
  
  for (const time of timePoints) {
    video.currentTime = time;
    
    // 等待 seek 完成
    await new Promise<void>(resolve => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
    });
    
    // 绘制并获取图像数据
    ctx.drawImage(video, 0, 0);
    frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }
  
  return frames;
}

// ==================== 多帧检测 ====================

export async function detectHoldsMultiFrame(
  frames: ImageData[],
  yoloDetect: (img: ImageData) => Promise<DetectionResult[]> = mockYoloDetect
): Promise<DetectionResult[]> {
  console.log(`[HoldDetector] 检测 ${frames.length} 帧...`);
  
  // 对每帧进行检测
  const allDetections: DetectionResult[][] = [];
  
  for (let i = 0; i < frames.length; i++) {
    const detections = await yoloDetect(frames[i]);
    console.log(`[HoldDetector] 帧 ${i + 1}: 检测到 ${detections.length} 个岩点`);
    allDetections.push(detections);
  }
  
  // 融合多帧结果
  const merged = mergeDetections(allDetections);
  console.log(`[HoldDetector] 融合后: ${merged.length} 个岩点`);
  
  return merged;
}

// ==================== 多帧融合对齐 ====================

function mergeDetections(
  allDetections: DetectionResult[][],
  iouThreshold: number = 0.5
): DetectionResult[] {
  if (allDetections.length === 0) return [];
  
  // 把所有检测结果放到一起
  const allBoxes: DetectionResult[] = allDetections.flat();
  
  if (allBoxes.length === 0) return [];
  
  // 按置信度排序
  allBoxes.sort((a, b) => b.confidence - a.confidence);
  
  // NMS 去重
  const kept: DetectionResult[] = [];
  const suppressed = new Set<number>();
  
  for (let i = 0; i < allBoxes.length; i++) {
    if (suppressed.has(i)) continue;
    
    const boxA = allBoxes[i];
    kept.push(boxA);
    
    // 抑制与当前框重叠的其他框
    for (let j = i + 1; j < allBoxes.length; j++) {
      if (suppressed.has(j)) continue;
      
      const boxB = allBoxes[j];
      if (computeIoU(boxA, boxB) > iouThreshold) {
        suppressed.add(j);
      }
    }
  }
  
  return kept;
}

function computeIoU(a: DetectionResult, b: DetectionResult): number {
  // 计算两个框的 IoU
  const ax1 = a.x - a.width / 2, ay1 = a.y - a.height / 2;
  const ax2 = a.x + a.width / 2, ay2 = a.y + a.height / 2;
  
  const bx1 = b.x - b.width / 2, by1 = b.y - b.height / 2;
  const bx2 = b.x + b.width / 2, by2 = b.y + b.height / 2;
  
  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);
  
  if (interX2 <= interX1 || interY2 <= interY1) return 0;
  
  const interArea = (interX2 - interX1) * (interY2 - interY1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  
  return interArea / (areaA + areaB - interArea);
}

// ==================== 颜色提取 ====================

export function extractHoldColors(
  detections: DetectionResult[],
  imageData: ImageData
): HoldWithColor[] {
  const { data, width } = imageData;
  
  return detections.map(det => {
    // 计算岩点区域
    const x1 = Math.max(0, Math.floor(det.x - det.width / 2));
    const y1 = Math.max(0, Math.floor(det.y - det.height / 2));
    const x2 = Math.min(imageData.width, Math.floor(det.x + det.width / 2));
    const y2 = Math.min(imageData.height, Math.floor(det.y + det.height / 2));
    
    // 采样区域内的像素
    let totalH = 0, totalS = 0, totalV = 0, count = 0;
    
    for (let y = y1; y < y2; y += 2) {  // 跳采提高速度
      for (let x = x1; x < x2; x += 2) {
        const idx = (y * width + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        
        // RGB to HSV
        const hsv = rgbToHsv(r, g, b);
        
        // 忽略太暗或太亮的像素（阴影/高光）
        if (hsv.v > 0.2 && hsv.v < 0.9 && hsv.s > 0.2) {
          totalH += hsv.h;
          totalS += hsv.s;
          totalV += hsv.v;
          count++;
        }
      }
    }
    
    const avgColor = count > 0 
      ? { h: totalH / count, s: totalS / count, v: totalV / count }
      : { h: 0, s: 0, v: 0.5 };
    
    return {
      ...det,
      color: avgColor,
      colorName: hsvToColorName(avgColor)
    };
  });
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  
  return { h: h * 360, s, v };
}

function hsvToColorName(hsv: { h: number; s: number; v: number }): string {
  const { h, s, v } = hsv;
  
  // 低饱和度 → 灰/白/黑
  if (s < 0.15) {
    if (v < 0.3) return 'black';
    if (v > 0.8) return 'white';
    return 'gray';
  }
  
  // 按色相分类
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 75) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 265) return 'blue';
  if (h < 290) return 'purple';
  if (h < 345) return 'pink';
  
  return 'unknown';
}

// ==================== 颜色聚类 → 线路分组 ====================

export function clusterByColor(
  holds: HoldWithColor[],
  hueThreshold: number = 25
): RouteGroup[] {
  const groups: RouteGroup[] = [];
  
  for (const hold of holds) {
    // 查找最接近的已有分组
    let bestGroup: RouteGroup | null = null;
    let bestDist = Infinity;
    
    for (const group of groups) {
      const dist = colorDistance(hold.color, group.colorHSV);
      if (dist < bestDist && dist < hueThreshold) {
        bestDist = dist;
        bestGroup = group;
      }
    }
    
    // 转换为 Hold 类型
    const holdObj: Hold = {
      id: `H${holds.indexOf(hold) + 1}`,
      x: hold.x,
      y: hold.y,
      radius: Math.max(hold.width, hold.height) / 2,
      color: [hold.color.h, hold.color.s, hold.color.v]
    };
    
    if (bestGroup) {
      bestGroup.holds.push(holdObj);
    } else {
      // 创建新分组
      groups.push({
        colorName: hold.colorName,
        colorHSV: { ...hold.color },
        holds: [holdObj],
        topHold: null,
        startHold: null
      });
    }
  }
  
  // 为每个线路确定 Top 和 Start
  for (const group of groups) {
    if (group.holds.length === 0) continue;
    
    // 按 Y 坐标排序 (Y 小 = 位置高)
    const sorted = [...group.holds].sort((a, b) => a.y - b.y);
    group.topHold = sorted[0];                    // 最高点
    group.startHold = sorted[sorted.length - 1]; // 最低点
  }
  
  return groups;
}

function colorDistance(
  a: { h: number; s: number; v: number },
  b: { h: number; s: number; v: number }
): number {
  // 色相是环形的
  let dh = Math.abs(a.h - b.h);
  if (dh > 180) dh = 360 - dh;
  
  return dh;  // 主要看色相差异
}

// ==================== 完整 Pipeline ====================

export interface HoldDetectionResult {
  allHolds: Hold[];
  routes: RouteGroup[];
  width: number;
  height: number;
}

export async function runHoldDetectionPipeline(
  video: HTMLVideoElement,
  yoloDetect?: (img: ImageData) => Promise<DetectionResult[]>
): Promise<HoldDetectionResult> {
  console.log('[HoldDetector] 开始岩点检测 Pipeline...');
  
  // Step 1: 抽取关键帧
  console.log('[HoldDetector] Step 1: 抽取关键帧');
  const frames = await extractKeyFrames(video, 5);
  
  // Step 2: 多帧检测 + 融合
  console.log('[HoldDetector] Step 2: YOLO 检测 + 多帧融合');
  const detections = await detectHoldsMultiFrame(frames, yoloDetect);
  
  // Step 3: 颜色提取 (使用中间帧，人遮挡最少)
  console.log('[HoldDetector] Step 3: 颜色提取');
  const middleFrame = frames[Math.floor(frames.length / 2)];
  const holdsWithColor = extractHoldColors(detections, middleFrame);
  
  // Step 4: 颜色聚类 → 线路分组
  console.log('[HoldDetector] Step 4: 颜色聚类');
  const routes = clusterByColor(holdsWithColor);
  
  // 收集所有 holds
  const allHolds = routes.flatMap(r => r.holds);
  
  console.log('[HoldDetector] Pipeline 完成!');
  console.log(`  - 检测到 ${allHolds.length} 个岩点`);
  console.log(`  - 识别出 ${routes.length} 条线路`);
  routes.forEach(r => {
    console.log(`    - ${r.colorName}: ${r.holds.length} 个点, Top=${r.topHold?.id}, Start=${r.startHold?.id}`);
  });
  
  return {
    allHolds,
    routes,
    width: video.videoWidth,
    height: video.videoHeight
  };
}

// ==================== Mock 数据 (用于测试) ====================

export function getMockDetectionResult(width: number, height: number): HoldDetectionResult {
  // 模拟一条灰色线路
  const grayHolds: Hold[] = [
    { id: 'G1', x: width * 0.3, y: height * 0.2, radius: 25, color: [0, 0.1, 0.5] },   // Top
    { id: 'G2', x: width * 0.35, y: height * 0.35, radius: 20, color: [0, 0.1, 0.5] },
    { id: 'G3', x: width * 0.28, y: height * 0.5, radius: 22, color: [0, 0.1, 0.5] },
    { id: 'G4', x: width * 0.4, y: height * 0.65, radius: 25, color: [0, 0.1, 0.5] },
    { id: 'G5', x: width * 0.32, y: height * 0.8, radius: 28, color: [0, 0.1, 0.5] },  // Start
  ];
  
  // 模拟一条黄色线路
  const yellowHolds: Hold[] = [
    { id: 'Y1', x: width * 0.6, y: height * 0.15, radius: 20, color: [55, 0.8, 0.9] },  // Top
    { id: 'Y2', x: width * 0.55, y: height * 0.4, radius: 25, color: [55, 0.8, 0.9] },
    { id: 'Y3', x: width * 0.65, y: height * 0.6, radius: 22, color: [55, 0.8, 0.9] },
    { id: 'Y4', x: width * 0.58, y: height * 0.85, radius: 30, color: [55, 0.8, 0.9] }, // Start
  ];
  
  const routes: RouteGroup[] = [
    {
      colorName: 'gray',
      colorHSV: { h: 0, s: 0.1, v: 0.5 },
      holds: grayHolds,
      topHold: grayHolds[0],
      startHold: grayHolds[grayHolds.length - 1]
    },
    {
      colorName: 'yellow',
      colorHSV: { h: 55, s: 0.8, v: 0.9 },
      holds: yellowHolds,
      topHold: yellowHolds[0],
      startHold: yellowHolds[yellowHolds.length - 1]
    }
  ];
  
  return {
    allHolds: [...grayHolds, ...yellowHolds],
    routes,
    width,
    height
  };
}

