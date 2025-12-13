/**
 * 岩点检测器 - 基于 Roboflow API
 * 
 * 流程:
 * 1. 智能帧采样 (开头1帧 + 中间3帧 + 结尾1帧)
 * 2. 调用 Roboflow API 检测岩点 (已含颜色分类)
 * 3. 多帧融合校准 (置信度筛选 + 位置去重)
 * 4. 线路过滤 (去除重合点 + 过滤少于5个点的线路)
 * 5. 通过中间帧的人体姿态确定当前线路
 */

import { 
  detectFromCanvas, 
  RoboflowPrediction, 
  getMainColor 
} from '../api/roboflow';
import { PoseDetector } from './pose_detector';
import { Keypoint } from '../types';
import { correctColors, CorrectedPrediction } from './color_correction';

// ============ 常量配置 ============

const MIN_HOLDS_PER_ROUTE = 5;  // 线路最少岩点数
const OVERLAP_THRESHOLD = 35;   // 重合判定距离 (像素)

// 颜色显示名
const COLOR_NAMES: Record<string, string> = {
  black: '黑色', blue: '蓝色', brown: '棕色', cyan: '青色',
  gray: '灰色', green: '绿色', orange: '橙色', pink: '粉色',
  purple: '紫色', red: '红色', white: '白色', yellow: '黄色',
};

// ============ 类型定义 ============

export interface DetectedHold {
  id: string;                // 如: yellow_1, yellow_TOP
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  color: string;             // 主颜色 (yellow, green, etc.)
  colorName: string;         // 显示名 (黄色, 绿色, etc.)
  colorClass: string;        // 完整类别 (yellow-hold, etc.)
  points: { x: number; y: number }[];  // 多边形轮廓
  isTop: boolean;            // 是否为 TOP 点
  order: number;             // 在线路中的顺序 (从低到高)
}

export interface Route {
  color: string;
  colorName: string;
  colorClass: string;
  holds: DetectedHold[];
  topHold: DetectedHold | null;
  startHold: DetectedHold | null;
}

export interface HoldDetectionResult {
  allHolds: DetectedHold[];
  routes: Route[];
  activeRoute: Route | null;  // 通过姿态检测确定的当前线路
  frameWidth: number;
  frameHeight: number;
}

interface FrameSample {
  imageData: ImageData;
  canvas: HTMLCanvasElement;
  timestamp: number;
  type: 'start' | 'middle' | 'end';
}

// ============ 帧采样 ============

/**
 * 智能帧采样
 */
async function sampleFrames(video: HTMLVideoElement): Promise<FrameSample[]> {
  const frames: FrameSample[] = [];
  const duration = video.duration;
  
  const samplePoints = [
    { time: Math.min(2.5, duration * 0.1), type: 'start' as const },
    { time: duration * (1/3), type: 'middle' as const },
    { time: duration * (1/2), type: 'middle' as const },
    { time: duration * (2/3), type: 'middle' as const },
    { time: Math.max(duration - 0.5, duration * 0.9), type: 'end' as const },
  ];
  
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  
  for (const point of samplePoints) {
    video.currentTime = point.time;
    
    await new Promise<void>(resolve => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
    });
    
    ctx.drawImage(video, 0, 0);
    
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = video.videoWidth;
    frameCanvas.height = video.videoHeight;
    frameCanvas.getContext('2d')!.drawImage(video, 0, 0);
    
    frames.push({
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
      canvas: frameCanvas,
      timestamp: point.time,
      type: point.type
    });
  }
  
  console.log(`[HoldDetector] 采样 ${frames.length} 帧`);
  return frames;
}

// ============ 多帧检测 ============

async function detectMultiFrame(
  frames: FrameSample[],
  minConfidence: number = 0.5
): Promise<RoboflowPrediction[][]> {
  const results: RoboflowPrediction[][] = [];
  
  for (let i = 0; i < frames.length; i++) {
    console.log(`[HoldDetector] 检测帧 ${i + 1}/${frames.length} (${frames[i].type})...`);
    
    try {
      const predictions = await detectFromCanvas(frames[i].canvas);
      const filtered = predictions.filter(p => p.confidence >= minConfidence);
      results.push(filtered);
      console.log(`[HoldDetector]   检测到 ${predictions.length} 个, 过滤后 ${filtered.length} 个`);
    } catch (error) {
      console.error(`[HoldDetector] 帧 ${i + 1} 检测失败:`, error);
      results.push([]);
    }
  }
  
  return results;
}

// ============ 颜色矫正 ============

/**
 * 对多帧检测结果应用颜色矫正
 * 使用 K-Means 在 HSV 空间重新聚类，消除光照影响
 */
async function applyColorCorrection(
  frameResults: RoboflowPrediction[][],
  frames: FrameSample[]
): Promise<RoboflowPrediction[][]> {
  // 选择一帧用于颜色矫正 (优先选中间帧)
  const middleFrameIdx = frames.findIndex(f => f.type === 'middle');
  const frameIdx = middleFrameIdx >= 0 ? middleFrameIdx : 0;
  const frame = frames[frameIdx];
  
  // 合并所有帧的检测结果作为输入
  const allPredictions = frameResults.flat();
  
  if (allPredictions.length < 3) {
    console.log('[HoldDetector] 检测结果太少，跳过颜色矫正');
    return frameResults;
  }
  
  try {
    // 调用颜色矫正算法
    const corrected = await correctColors(allPredictions, frame.canvas);
    
    // 建立原始预测到矫正结果的映射
    const correctionMap = new Map<RoboflowPrediction, CorrectedPrediction>();
    for (let i = 0; i < allPredictions.length; i++) {
      correctionMap.set(allPredictions[i], corrected[i]);
    }
    
    // 将矫正后的颜色应用回每帧结果
    const correctedFrameResults: RoboflowPrediction[][] = [];
    
    for (const framePreds of frameResults) {
      const correctedPreds = framePreds.map(pred => {
        const correctedPred = correctionMap.get(pred);
        if (correctedPred) {
          // 更新颜色相关字段
          const newClass = `${correctedPred.corrected_color}-hold`;
          return {
            ...pred,
            class: newClass,
            // 保留原始数据，添加矫正信息
            _original_class: pred.class,
            _route_id: correctedPred.route_id,
            _route_hsv: correctedPred.route_hsv_center
          } as RoboflowPrediction;
        }
        return pred;
      });
      correctedFrameResults.push(correctedPreds);
    }
    
    console.log('[HoldDetector] 颜色矫正完成');
    return correctedFrameResults;
    
  } catch (error) {
    console.error('[HoldDetector] 颜色矫正失败:', error);
    return frameResults;
  }
}

// ============ 多帧融合 ============

interface MergedHold {
  predictions: RoboflowPrediction[];
  avgX: number;
  avgY: number;
  frameCount: number;
  color: string;
}

function mergeDetections(
  frameResults: RoboflowPrediction[][],
  mergeThreshold: number = 40
): MergedHold[] {
  const merged: MergedHold[] = [];
  
  for (const framePreds of frameResults) {
    for (const pred of framePreds) {
      let found = false;
      const predColor = getMainColor(pred.class);
      
      for (const m of merged) {
        const dist = Math.sqrt(
          Math.pow(pred.x - m.avgX, 2) + 
          Math.pow(pred.y - m.avgY, 2)
        );
        
        // 位置接近 且 颜色相同
        if (dist < mergeThreshold && predColor === m.color) {
          m.predictions.push(pred);
          m.avgX = m.predictions.reduce((s, p) => s + p.x, 0) / m.predictions.length;
          m.avgY = m.predictions.reduce((s, p) => s + p.y, 0) / m.predictions.length;
          m.frameCount++;
          found = true;
          break;
        }
      }
      
      if (!found) {
        merged.push({
          predictions: [pred],
          avgX: pred.x,
          avgY: pred.y,
          frameCount: 1,
          color: predColor
        });
      }
    }
  }
  
  // 过滤只出现1帧且置信度低的
  const filtered = merged.filter(m => {
    const best = m.predictions.reduce((a, b) => a.confidence > b.confidence ? a : b);
    return !(m.frameCount === 1 && best.confidence < 0.7);
  });
  
  console.log(`[HoldDetector] 融合结果: ${merged.length} → ${filtered.length} 个岩点`);
  return filtered;
}

// ============ 去除不同线路间的重合点 ============

/**
 * 去除不同颜色线路间的重合点
 * 保留置信度更高的那个
 */
function removeOverlappingHolds(mergedHolds: MergedHold[]): MergedHold[] {
  const result: MergedHold[] = [];
  const removed = new Set<number>();
  
  for (let i = 0; i < mergedHolds.length; i++) {
    if (removed.has(i)) continue;
    
    const hold1 = mergedHolds[i];
    let keepThis = true;
    
    for (let j = i + 1; j < mergedHolds.length; j++) {
      if (removed.has(j)) continue;
      
      const hold2 = mergedHolds[j];
      
      // 不同颜色的点才需要检查重合
      if (hold1.color === hold2.color) continue;
      
      const dist = Math.sqrt(
        Math.pow(hold1.avgX - hold2.avgX, 2) +
        Math.pow(hold1.avgY - hold2.avgY, 2)
      );
      
      if (dist < OVERLAP_THRESHOLD) {
        // 重合了，保留置信度更高的
        const conf1 = Math.max(...hold1.predictions.map(p => p.confidence));
        const conf2 = Math.max(...hold2.predictions.map(p => p.confidence));
        
        if (conf1 >= conf2) {
          removed.add(j);
          console.log(`[HoldDetector] 移除重合点: ${hold2.color} (被 ${hold1.color} 覆盖)`);
        } else {
          removed.add(i);
          keepThis = false;
          console.log(`[HoldDetector] 移除重合点: ${hold1.color} (被 ${hold2.color} 覆盖)`);
          break;
        }
      }
    }
    
    if (keepThis) {
      result.push(hold1);
    }
  }
  
  console.log(`[HoldDetector] 去重后: ${mergedHolds.length} → ${result.length} 个岩点`);
  return result;
}

// ============ 线路分组与命名 ============

/**
 * 按颜色分组，过滤少于5个点的线路，并重新命名岩点
 */
function groupHoldsToRoutes(mergedHolds: MergedHold[]): { routes: Route[]; allHolds: DetectedHold[] } {
  // 按颜色分组
  const colorGroups = new Map<string, MergedHold[]>();
  
  for (const hold of mergedHolds) {
    if (!colorGroups.has(hold.color)) {
      colorGroups.set(hold.color, []);
    }
    colorGroups.get(hold.color)!.push(hold);
  }
  
  const routes: Route[] = [];
  const allHolds: DetectedHold[] = [];
  
  for (const [color, groupHolds] of colorGroups) {
    // 过滤少于5个点的线路
    if (groupHolds.length < MIN_HOLDS_PER_ROUTE) {
      console.log(`[HoldDetector] 过滤线路: ${color} (只有 ${groupHolds.length} 个点, 少于 ${MIN_HOLDS_PER_ROUTE})`);
      continue;
    }
    
    // 按 Y 坐标排序 (从高到低，Y 小 = 位置高)
    const sorted = [...groupHolds].sort((a, b) => a.avgY - b.avgY);
    
    const colorName = COLOR_NAMES[color] || color;
    const routeHolds: DetectedHold[] = [];
    
    // 为每个岩点命名
    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      const best = m.predictions.reduce((a, b) => a.confidence > b.confidence ? a : b);
      
      const isTop = i === 0;  // 最高点是 TOP
      const order = sorted.length - i;  // 从低到高: 1, 2, 3... TOP
      
      // 命名: yellow_1, yellow_2, ..., yellow_TOP
      const id = isTop ? `${color}_TOP` : `${color}_${order}`;
      
      const hold: DetectedHold = {
        id,
        x: m.avgX,
        y: m.avgY,
        width: best.width,
        height: best.height,
        confidence: best.confidence,
        color,
        colorName,
        colorClass: best.class,
        points: best.points || [],
        isTop,
        order
      };
      
      routeHolds.push(hold);
      allHolds.push(hold);
    }
    
    routes.push({
      color,
      colorName,
      colorClass: routeHolds[0].colorClass,
      holds: routeHolds,
      topHold: routeHolds[0] || null,       // 第一个是最高的
      startHold: routeHolds[routeHolds.length - 1] || null  // 最后一个是最低的
    });
  }
  
  // 按岩点数量排序
  routes.sort((a, b) => b.holds.length - a.holds.length);
  
  console.log(`[HoldDetector] 有效线路 ${routes.length} 条:`, 
    routes.map(r => `${r.colorName}(${r.holds.length}个)`).join(', '));
  
  return { routes, allHolds };
}

// ============ 通过姿态确定线路 ============

async function detectActiveRoute(
  middleFrames: FrameSample[],
  holds: DetectedHold[],
  routes: Route[],
  poseDetector: PoseDetector
): Promise<Route | null> {
  const colorVotes = new Map<string, number>();
  
  for (const frame of middleFrames) {
    const canvas = frame.canvas;
    const poses = await detectPoseFromCanvas(poseDetector, canvas);
    
    if (poses.length === 0) continue;
    
    const limbs = [
      poses.find(p => p.name === 'left_wrist'),
      poses.find(p => p.name === 'right_wrist'),
      poses.find(p => p.name === 'left_ankle'),
      poses.find(p => p.name === 'right_ankle'),
    ].filter(p => p && (p.score || 0) > 0.3) as Keypoint[];
    
    for (const limb of limbs) {
      const touchedHold = findNearestHold(limb, holds, 50);
      if (touchedHold) {
        const votes = colorVotes.get(touchedHold.color) || 0;
        colorVotes.set(touchedHold.color, votes + 1);
      }
    }
  }
  
  let maxVotes = 0;
  let activeColor: string | null = null;
  
  for (const [color, votes] of colorVotes) {
    if (votes > maxVotes) {
      maxVotes = votes;
      activeColor = color;
    }
  }
  
  if (activeColor) {
    const activeRoute = routes.find(r => r.color === activeColor);
    console.log(`[HoldDetector] 检测到当前线路: ${activeColor} (票数: ${maxVotes})`);
    return activeRoute || null;
  }
  
  console.log('[HoldDetector] 未能确定当前线路');
  return null;
}

async function detectPoseFromCanvas(
  poseDetector: PoseDetector,
  canvas: HTMLCanvasElement
): Promise<Keypoint[]> {
  const img = new Image();
  img.width = canvas.width;
  img.height = canvas.height;
  img.src = canvas.toDataURL();
  
  await new Promise(resolve => { img.onload = resolve; });
  
  if (!poseDetector.detector) return [];
  
  try {
    const poses = await poseDetector.detector.estimatePoses(img as any);
    if (poses.length > 0) {
      return poses[0].keypoints.map(kp => ({
        x: kp.x,
        y: kp.y,
        score: kp.score,
        name: kp.name
      }));
    }
  } catch (e) {
    console.warn('[HoldDetector] 姿态检测失败:', e);
  }
  
  return [];
}

function findNearestHold(
  point: Keypoint,
  holds: DetectedHold[],
  maxDist: number
): DetectedHold | null {
  let nearest: DetectedHold | null = null;
  let minDist = Infinity;
  
  for (const hold of holds) {
    const dist = Math.sqrt(
      Math.pow(point.x - hold.x, 2) + 
      Math.pow(point.y - hold.y, 2)
    );
    
    if (dist < minDist && dist < maxDist) {
      minDist = dist;
      nearest = hold;
    }
  }
  
  return nearest;
}

// ============ 主入口 ============

export interface DetectionOptions {
  minConfidence?: number;
  mergeThreshold?: number;
  detectActiveRoute?: boolean;
  minHoldsPerRoute?: number;  // 线路最少岩点数
  enableColorCorrection?: boolean;  // 启用 K-Means 颜色矫正
}

export async function detectHolds(
  video: HTMLVideoElement,
  poseDetector?: PoseDetector,
  options: DetectionOptions = {}
): Promise<HoldDetectionResult> {
  const {
    minConfidence = 0.5,
    mergeThreshold = 40,
    detectActiveRoute: shouldDetectRoute = true,
    enableColorCorrection = true  // 默认启用颜色矫正
  } = options;
  
  console.log('[HoldDetector] ========== 开始岩点检测 ==========');
  console.log(`[HoldDetector] 视频: ${video.videoWidth}x${video.videoHeight}, 时长: ${video.duration.toFixed(1)}s`);
  
  // Step 1: 帧采样
  const frames = await sampleFrames(video);
  
  // Step 2: 多帧检测
  let frameResults = await detectMultiFrame(frames, minConfidence);
  
  // Step 2.5: 颜色矫正 (使用 K-Means 聚类)
  if (enableColorCorrection && frames.length > 0) {
    console.log('[HoldDetector] 执行颜色矫正...');
    frameResults = await applyColorCorrection(frameResults, frames);
  }
  
  // Step 3: 融合去重 (同颜色)
  let mergedHolds = mergeDetections(frameResults, mergeThreshold);
  
  // Step 4: 去除不同颜色间的重合点
  mergedHolds = removeOverlappingHolds(mergedHolds);
  
  // Step 5: 线路分组 (过滤少于5个点的线路 + 重新命名)
  const { routes, allHolds } = groupHoldsToRoutes(mergedHolds);
  
  // Step 6: 检测当前线路 (可选)
  let activeRoute: Route | null = null;
  
  if (shouldDetectRoute && poseDetector && routes.length > 0) {
    const middleFrames = frames.filter(f => f.type === 'middle');
    activeRoute = await detectActiveRoute(middleFrames, allHolds, routes, poseDetector);
  }
  
  console.log('[HoldDetector] ========== 检测完成 ==========');
  console.log(`[HoldDetector] 总计: ${allHolds.length} 个岩点, ${routes.length} 条有效线路`);
  if (activeRoute) {
    console.log(`[HoldDetector] 当前线路: ${activeRoute.colorName} (${activeRoute.holds.length} 个岩点)`);
  }
  
  return {
    allHolds,
    routes,
    activeRoute,
    frameWidth: video.videoWidth,
    frameHeight: video.videoHeight
  };
}

// ============ 绘制工具 ============

const COLOR_HEX: Record<string, string> = {
  black: '#1a1a1a', blue: '#3b82f6', brown: '#a16207',
  cyan: '#06b6d4', gray: '#6b7280', green: '#22c55e',
  orange: '#f97316', pink: '#ec4899', purple: '#a855f7',
  red: '#ef4444', white: '#f5f5f5', yellow: '#eab308',
};

export function drawDetectionResult(
  ctx: CanvasRenderingContext2D,
  result: HoldDetectionResult,
  options: {
    highlightRoute?: string;
    showLabels?: boolean;
    showPolygon?: boolean;
  } = {}
) {
  const { highlightRoute, showLabels = true, showPolygon = true } = options;
  
  for (const hold of result.allHolds) {
    const isHighlighted = !highlightRoute || hold.color === highlightRoute;
    const color = COLOR_HEX[hold.color] || '#888888';
    const alpha = isHighlighted ? 1 : 0.3;
    
    ctx.globalAlpha = alpha;
    
    // 绘制多边形
    if (showPolygon && hold.points && hold.points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(hold.points[0].x, hold.points[0].y);
      for (const pt of hold.points.slice(1)) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fillStyle = color + '40';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = isHighlighted ? 3 : 1;
      ctx.stroke();
    } else {
      // 绘制圆形
      ctx.beginPath();
      ctx.arc(hold.x, hold.y, Math.max(hold.width, hold.height) / 2, 0, Math.PI * 2);
      ctx.fillStyle = color + '40';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    
    // 绘制标签 (显示有意义的名称如 yellow_1, yellow_TOP)
    if (showLabels && isHighlighted) {
      const labelX = hold.x - hold.width / 2;
      const labelY = hold.y - hold.height / 2 - 5;
      
      // 背景
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      const textWidth = ctx.measureText(hold.id).width;
      ctx.fillRect(labelX - 2, labelY - 12, textWidth + 4, 14);
      
      // 文字
      ctx.fillStyle = hold.isTop ? '#00ff00' : color;
      ctx.font = hold.isTop ? 'bold 12px Arial' : '11px Arial';
      ctx.fillText(hold.id, labelX, labelY);
    }
  }
  
  ctx.globalAlpha = 1;
  
  // 标记当前线路的 Top 和 Start
  if (highlightRoute) {
    const route = result.routes.find(r => r.color === highlightRoute);
    if (route) {
      if (route.topHold) {
        drawMarker(ctx, route.topHold, '🎯 TOP', '#00ff00');
      }
      if (route.startHold) {
        drawMarker(ctx, route.startHold, '🚀 START', '#ff6600');
      }
    }
  }
}

function drawMarker(ctx: CanvasRenderingContext2D, hold: DetectedHold, label: string, color: string) {
  // 标记圆圈
  ctx.beginPath();
  ctx.arc(hold.x, hold.y, 12, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // 标签
  ctx.fillStyle = color;
  ctx.font = 'bold 14px Arial';
  ctx.fillText(label, hold.x - 25, hold.y - hold.height / 2 - 20);
}
