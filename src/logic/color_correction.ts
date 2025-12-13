/**
 * 抱石线路颜色矫正算法
 * 
 * 通过 K-Means 聚类算法，在 HSV 颜色空间对图像中检测到的所有岩点进行重新分组，
 * 消除光照和阴影对岩点颜色分类的影响，实现准确的抱石线路识别。
 */

import { RoboflowPrediction, Point } from '../api/roboflow';

// ============ 类型定义 ============

export interface CorrectedPrediction extends RoboflowPrediction {
  route_id: number;                    // 0 到 K-1 的线路ID
  route_hsv_center: [number, number, number]; // 线路的平均 H/S/V
  corrected_color: string;             // 矫正后的颜色名称
}

interface HSVColor {
  h: number;  // 0-360
  s: number;  // 0-100
  v: number;  // 0-100
}

interface HoldFeature {
  index: number;
  prediction: RoboflowPrediction;
  avgHSV: HSVColor;
  feature: [number, number]; // [H, S] 用于聚类
}

// ============ 常量配置 ============

const V_THRESHOLD = 15;        // 亮度阈值，过滤阴影
const S_THRESHOLD = 10;        // 饱和度阈值，用于识别灰色/黑色/白色
const MAX_ROUTES = 8;          // 最大线路数
const SAMPLE_PIXELS = 500;     // 每个岩点采样像素数
const KMEANS_ITERATIONS = 50;  // K-Means 迭代次数

// ============ 颜色名称映射 ============

const COLOR_NAMES: Record<string, string> = {
  red: '红色', orange: '橙色', yellow: '黄色', green: '绿色',
  cyan: '青色', blue: '蓝色', purple: '紫色', pink: '粉色',
  gray: '灰色', black: '黑色', white: '白色', brown: '棕色',
};

// ============ 主入口函数 ============

/**
 * 对 Roboflow 检测结果进行颜色矫正
 */
export async function correctColors(
  predictions: RoboflowPrediction[],
  imageSource: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement
): Promise<CorrectedPrediction[]> {
  if (predictions.length === 0) {
    return [];
  }
  
  console.log(`[ColorCorrection] 开始颜色矫正, ${predictions.length} 个岩点`);
  
  // Step A: 获取图像像素数据
  const imageData = getImageData(imageSource);
  
  // Step A2-A4: 提取每个岩点的 HSV 特征
  const features = extractFeatures(predictions, imageData);
  
  if (features.length < 2) {
    console.log('[ColorCorrection] 岩点数量不足，跳过聚类');
    return predictions.map(p => ({
      ...p,
      route_id: 0,
      route_hsv_center: [0, 0, 0],
      corrected_color: getMainColorFromClass(p.class)
    }));
  }
  
  // Step B: 确定 K 值
  const K = determineK(predictions, features);
  console.log(`[ColorCorrection] 聚类数 K = ${K}`);
  
  // Step B2: 执行 K-Means 聚类
  const clusters = kMeansClustering(features, K);
  
  // Step C: 结果矫正与输出
  const corrected = applyCorrection(predictions, features, clusters, K);
  
  console.log(`[ColorCorrection] 矫正完成, 识别 ${K} 条线路`);
  
  return corrected;
}

// ============ 阶段 A: 数据准备与特征提取 ============

/**
 * A1: 获取图像像素数据
 */
function getImageData(source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): ImageData {
  const canvas = document.createElement('canvas');
  
  if (source instanceof HTMLCanvasElement) {
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(source, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
  
  if (source instanceof HTMLVideoElement) {
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
  } else {
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
  }
  
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * A2-A4: 提取所有岩点的 HSV 特征
 */
function extractFeatures(
  predictions: RoboflowPrediction[],
  imageData: ImageData
): HoldFeature[] {
  const features: HoldFeature[] = [];
  
  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    
    // 提取岩点区域像素的 HSV 值
    const hsvPixels = extractHoldPixels(pred, imageData);
    
    if (hsvPixels.length === 0) continue;
    
    // 计算平均 HSV (使用循环平均处理色相)
    const avgHSV = calculateAverageHSV(hsvPixels);
    
    features.push({
      index: i,
      prediction: pred,
      avgHSV,
      feature: [avgHSV.h, avgHSV.s] // 只用 H 和 S 进行聚类
    });
  }
  
  return features;
}

/**
 * A2: 提取岩点区域的 HSV 像素
 */
function extractHoldPixels(
  prediction: RoboflowPrediction,
  imageData: ImageData
): HSVColor[] {
  const { width, height, data } = imageData;
  const hsvPixels: HSVColor[] = [];
  
  // 使用边界框
  const boxLeft = Math.max(0, Math.floor(prediction.x - prediction.width / 2));
  const boxTop = Math.max(0, Math.floor(prediction.y - prediction.height / 2));
  const boxRight = Math.min(width, Math.ceil(prediction.x + prediction.width / 2));
  const boxBottom = Math.min(height, Math.ceil(prediction.y + prediction.height / 2));
  
  // 如果有多边形轮廓，使用它来精确提取
  const hasPolygon = prediction.points && prediction.points.length > 2;
  
  // 采样策略：网格采样以提高性能
  const boxWidth = boxRight - boxLeft;
  const boxHeight = boxBottom - boxTop;
  const totalPixels = boxWidth * boxHeight;
  const sampleStep = Math.max(1, Math.floor(Math.sqrt(totalPixels / SAMPLE_PIXELS)));
  
  for (let y = boxTop; y < boxBottom; y += sampleStep) {
    for (let x = boxLeft; x < boxRight; x += sampleStep) {
      // 如果有多边形，检查点是否在多边形内
      if (hasPolygon && !isPointInPolygon(x, y, prediction.points!)) {
        continue;
      }
      
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      const hsv = rgbToHsv(r, g, b);
      
      // 过滤过暗的像素（阴影/背景）
      if (hsv.v > V_THRESHOLD) {
        hsvPixels.push(hsv);
      }
    }
  }
  
  return hsvPixels;
}

/**
 * A3: 计算平均 HSV（使用循环平均处理色相）
 */
function calculateAverageHSV(pixels: HSVColor[]): HSVColor {
  if (pixels.length === 0) {
    return { h: 0, s: 0, v: 0 };
  }
  
  // 色相使用向量平均（处理循环性质）
  let sinSum = 0, cosSum = 0;
  let sSum = 0, vSum = 0;
  
  for (const pixel of pixels) {
    const hRad = (pixel.h * Math.PI) / 180;
    sinSum += Math.sin(hRad);
    cosSum += Math.cos(hRad);
    sSum += pixel.s;
    vSum += pixel.v;
  }
  
  const n = pixels.length;
  
  // 计算平均色相
  let avgH = (Math.atan2(sinSum / n, cosSum / n) * 180) / Math.PI;
  if (avgH < 0) avgH += 360;
  
  return {
    h: avgH,
    s: sSum / n,
    v: vSum / n
  };
}

// ============ 阶段 B: K-Means 聚类 ============

/**
 * B1: 确定 K 值
 */
function determineK(predictions: RoboflowPrediction[], features: HoldFeature[]): number {
  // 使用 Roboflow 初始分类中不同 class 的数量作为参考
  const uniqueClasses = new Set(predictions.map(p => p.class));
  const initialK = uniqueClasses.size;
  
  // 限制在合理范围内
  const K = Math.max(2, Math.min(initialK, MAX_ROUTES, Math.floor(features.length / 3)));
  
  return K;
}

/**
 * B2: 简单的 K-Means 聚类实现
 * (避免引入额外依赖)
 */
function kMeansClustering(
  features: HoldFeature[],
  K: number
): number[] {
  const points = features.map(f => f.feature);
  const n = points.length;
  
  if (n <= K) {
    return points.map((_, i) => i);
  }
  
  // 初始化质心（K-Means++ 风格）
  let centroids = initializeCentroids(points, K);
  let assignments = new Array(n).fill(0);
  
  for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
    // 分配阶段：将每个点分配到最近的质心
    const newAssignments = points.map(point => 
      findNearestCentroid(point, centroids)
    );
    
    // 检查是否收敛
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    
    if (!changed) {
      console.log(`[ColorCorrection] K-Means 在第 ${iter + 1} 次迭代后收敛`);
      break;
    }
    
    // 更新阶段：重新计算质心
    centroids = updateCentroids(points, assignments, K);
  }
  
  return assignments;
}

/**
 * 初始化质心 (K-Means++ 风格)
 */
function initializeCentroids(points: [number, number][], K: number): [number, number][] {
  const centroids: [number, number][] = [];
  const used = new Set<number>();
  
  // 随机选择第一个质心
  const firstIdx = Math.floor(Math.random() * points.length);
  centroids.push([...points[firstIdx]]);
  used.add(firstIdx);
  
  // 选择剩余质心
  while (centroids.length < K) {
    // 计算每个点到最近质心的距离
    const distances = points.map((point, idx) => {
      if (used.has(idx)) return 0;
      const minDist = Math.min(...centroids.map(c => hsvDistance(point, c)));
      return minDist * minDist; // 距离平方
    });
    
    // 按距离概率选择下一个质心
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalDist;
    
    for (let i = 0; i < points.length; i++) {
      rand -= distances[i];
      if (rand <= 0 && !used.has(i)) {
        centroids.push([...points[i]]);
        used.add(i);
        break;
      }
    }
  }
  
  return centroids;
}

/**
 * 找到最近的质心
 */
function findNearestCentroid(point: [number, number], centroids: [number, number][]): number {
  let minDist = Infinity;
  let nearest = 0;
  
  for (let i = 0; i < centroids.length; i++) {
    const dist = hsvDistance(point, centroids[i]);
    if (dist < minDist) {
      minDist = dist;
      nearest = i;
    }
  }
  
  return nearest;
}

/**
 * 更新质心
 */
function updateCentroids(
  points: [number, number][],
  assignments: number[],
  K: number
): [number, number][] {
  const newCentroids: [number, number][] = [];
  
  for (let k = 0; k < K; k++) {
    const clusterPoints = points.filter((_, i) => assignments[i] === k);
    
    if (clusterPoints.length === 0) {
      // 空簇，随机重新初始化
      const randomIdx = Math.floor(Math.random() * points.length);
      newCentroids.push([...points[randomIdx]]);
    } else {
      // 使用循环平均计算色相
      let sinSum = 0, cosSum = 0, sSum = 0;
      
      for (const [h, s] of clusterPoints) {
        const hRad = (h * Math.PI) / 180;
        sinSum += Math.sin(hRad);
        cosSum += Math.cos(hRad);
        sSum += s;
      }
      
      const n = clusterPoints.length;
      let avgH = (Math.atan2(sinSum / n, cosSum / n) * 180) / Math.PI;
      if (avgH < 0) avgH += 360;
      
      newCentroids.push([avgH, sSum / n]);
    }
  }
  
  return newCentroids;
}

/**
 * HSV 空间距离（考虑色相的循环性）
 */
function hsvDistance(a: [number, number], b: [number, number]): number {
  // 色相差（考虑循环）
  let hDiff = Math.abs(a[0] - b[0]);
  if (hDiff > 180) hDiff = 360 - hDiff;
  
  // 饱和度差
  const sDiff = Math.abs(a[1] - b[1]);
  
  // 加权距离（色相权重更高）
  return Math.sqrt(hDiff * hDiff + sDiff * sDiff * 0.5);
}

// ============ 阶段 C: 结果矫正与输出 ============

/**
 * C1-C3: 应用矫正结果
 */
function applyCorrection(
  predictions: RoboflowPrediction[],
  features: HoldFeature[],
  clusters: number[],
  K: number
): CorrectedPrediction[] {
  // 计算每个簇的中心
  const clusterCenters = calculateClusterCenters(features, clusters, K);
  
  // 为每个簇确定颜色名称
  const clusterColors = clusterCenters.map(center => 
    hsvToColorName(center[0], center[1], center[2])
  );
  
  console.log('[ColorCorrection] 簇中心:');
  clusterCenters.forEach((center, i) => {
    console.log(`  簇${i}: H=${center[0].toFixed(0)}°, S=${center[1].toFixed(0)}%, V=${center[2].toFixed(0)}% → ${clusterColors[i]}`);
  });
  
  // 构建结果
  const corrected: CorrectedPrediction[] = predictions.map((pred, predIdx) => {
    // 找到对应的特征
    const featureIdx = features.findIndex(f => f.index === predIdx);
    
    if (featureIdx === -1) {
      // 没有特征数据，使用原始分类
      return {
        ...pred,
        route_id: 0,
        route_hsv_center: [0, 0, 0] as [number, number, number],
        corrected_color: getMainColorFromClass(pred.class)
      };
    }
    
    const clusterId = clusters[featureIdx];
    const center = clusterCenters[clusterId];
    
    return {
      ...pred,
      route_id: clusterId,
      route_hsv_center: center,
      corrected_color: clusterColors[clusterId]
    };
  });
  
  return corrected;
}

/**
 * C2: 计算每个簇的中心
 */
function calculateClusterCenters(
  features: HoldFeature[],
  clusters: number[],
  K: number
): [number, number, number][] {
  const centers: [number, number, number][] = [];
  
  for (let k = 0; k < K; k++) {
    const clusterFeatures = features.filter((_, i) => clusters[i] === k);
    
    if (clusterFeatures.length === 0) {
      centers.push([0, 0, 0]);
      continue;
    }
    
    // 使用循环平均计算色相
    let sinSum = 0, cosSum = 0;
    let sSum = 0, vSum = 0;
    
    for (const f of clusterFeatures) {
      const hRad = (f.avgHSV.h * Math.PI) / 180;
      sinSum += Math.sin(hRad);
      cosSum += Math.cos(hRad);
      sSum += f.avgHSV.s;
      vSum += f.avgHSV.v;
    }
    
    const n = clusterFeatures.length;
    let avgH = (Math.atan2(sinSum / n, cosSum / n) * 180) / Math.PI;
    if (avgH < 0) avgH += 360;
    
    centers.push([avgH, sSum / n, vSum / n]);
  }
  
  return centers;
}

// ============ 辅助函数 ============

/**
 * RGB 转 HSV
 */
function rgbToHsv(r: number, g: number, b: number): HSVColor {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  
  let h = 0;
  let s = max === 0 ? 0 : (delta / max) * 100;
  let v = max * 100;
  
  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }
  
  if (h < 0) h += 360;
  
  return { h, s, v };
}

/**
 * HSV 转颜色名称
 */
function hsvToColorName(h: number, s: number, v: number): string {
  // 处理特殊颜色
  if (v < 20) return 'black';
  if (s < 15 && v > 80) return 'white';
  if (s < 15) return 'gray';
  
  // 根据色相判断颜色
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 75) return 'yellow';
  if (h < 150) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 285) return 'purple';
  if (h < 345) return 'pink';
  
  return 'gray';
}

/**
 * 从 class 名称提取主颜色
 */
function getMainColorFromClass(className: string): string {
  return className.replace('-hold', '').split('-')[0];
}

/**
 * 点是否在多边形内
 */
function isPointInPolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

// ============ 导出辅助函数 ============

export { rgbToHsv, hsvToColorName, COLOR_NAMES };

