/**
 * Roboflow API - 岩点检测
 */

import apiKeyRaw from '../../apikey.txt?raw';

const API_URL = 'https://serverless.roboflow.com/gripgenuis/workflows/custom-workflow-5';
// 支持 "KEY" 或 "VITE_ROBOFLOW_API_KEY=KEY" 两种格式
const API_KEY = apiKeyRaw.trim().replace(/^VITE_ROBOFLOW_API_KEY=/, '');

// ============ 类型定义 ============

/** 支持的岩点颜色类别 */
export type HoldClass =
  | 'black-hold'
  | 'black-pink-hold'
  | 'black-white-hold'
  | 'black-yellow-hold'
  | 'blue-hold'
  | 'brown-hold'
  | 'cyan-hold'
  | 'gray-hold'
  | 'green-hold'
  | 'orange-hold'
  | 'pink-hold'
  | 'purple-hold'
  | 'red-hold'
  | 'white-hold'
  | 'yellow-hold'
  | 'yellow-purple-hold';

/** 多边形顶点 */
export interface Point {
  x: number;
  y: number;
}

/** API 原始返回的单个预测 */
interface RawPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class_id: number;
  class?: string;
  detection_id?: string;
  points?: Point[];
}

/** API 原始响应结构 */
interface RawApiResponse {
  outputs: Array<{
    predictions: {
      image: { width: number; height: number };
      predictions: RawPrediction[];
    };
  }>;
  profiler_trace?: unknown[];
}

/** 标准化后的检测结果 */
export interface RoboflowPrediction {
  x: number;              // 中心点 x
  y: number;              // 中心点 y
  width: number;          // 边界框宽度
  height: number;         // 边界框高度
  confidence: number;     // 置信度 0-1
  class: HoldClass;       // 颜色类别
  class_id: number;       // 类别ID (0-15)
  detection_id: string;   // 唯一检测ID
  points: Point[];        // 多边形轮廓点 (可能为空)
}

// ============ 类别映射 ============

/** 类别ID到颜色映射 */
export const CLASS_ID_MAP: Record<number, HoldClass> = {
  0: 'black-hold',
  1: 'black-pink-hold',
  2: 'black-white-hold',
  3: 'blue-hold',
  4: 'brown-hold',
  5: 'cyan-hold',
  6: 'gray-hold',
  7: 'green-hold',
  8: 'orange-hold',
  9: 'pink-hold',
  10: 'purple-hold',
  11: 'red-hold',
  12: 'white-hold',
  13: 'yellow-hold',
  14: 'yellow-purple-hold',
  15: 'black-yellow-hold',
};

/** 颜色显示名 */
export const COLOR_NAMES: Record<string, string> = {
  'black': '黑色',
  'blue': '蓝色',
  'brown': '棕色',
  'cyan': '青色',
  'gray': '灰色',
  'green': '绿色',
  'orange': '橙色',
  'pink': '粉色',
  'purple': '紫色',
  'red': '红色',
  'white': '白色',
  'yellow': '黄色',
};

// ============ 辅助函数 ============

/** 从类别名提取主颜色 */
export function getMainColor(holdClass: HoldClass | string): string {
  // 处理双色情况，取第一个颜色
  const color = holdClass.replace('-hold', '').split('-')[0];
  return color;
}

/** 将原始预测转换为标准格式 */
function normalizePrediction(raw: RawPrediction, index: number): RoboflowPrediction {
  const holdClass = CLASS_ID_MAP[raw.class_id] || 'gray-hold';
  
  return {
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    confidence: raw.confidence,
    class: holdClass,
    class_id: raw.class_id,
    detection_id: raw.detection_id || `det-${index}`,
    points: raw.points || []
  };
}

/** 解析 API 响应 */
function parseApiResponse(data: RawApiResponse): RoboflowPrediction[] {
  try {
    // 结构: outputs[0].predictions.predictions[]
    const outputs = data.outputs;
    if (!outputs || outputs.length === 0) {
      console.warn('[Roboflow] 响应无 outputs');
      return [];
    }

    const predWrapper = outputs[0]?.predictions;
    if (!predWrapper) {
      console.warn('[Roboflow] 响应无 predictions wrapper');
      return [];
    }

    const rawPredictions = predWrapper.predictions;
    if (!rawPredictions || !Array.isArray(rawPredictions)) {
      console.warn('[Roboflow] 响应无 predictions 数组');
      return [];
    }

    console.log(`[Roboflow] 解析到 ${rawPredictions.length} 个检测结果`);
    
    return rawPredictions.map((raw, idx) => normalizePrediction(raw, idx));
  } catch (e) {
    console.error('[Roboflow] 解析响应失败:', e);
    return [];
  }
}

// ============ API 请求 ============

/**
 * 通过图片 URL 检测岩点
 */
export async function detectByUrl(imageUrl: string): Promise<RoboflowPrediction[]> {
  console.log('[Roboflow] 请求 URL 检测...');
  
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: API_KEY,
      inputs: {
        image: { type: 'url', value: imageUrl }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  const data = await response.json();
  return parseApiResponse(data);
}

/**
 * 通过 Base64 图片检测岩点
 */
export async function detectByBase64(base64: string): Promise<RoboflowPrediction[]> {
  console.log('[Roboflow] 请求 Base64 检测...');
  
  // 移除 data URL 前缀
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: API_KEY,
      inputs: {
        image: { type: 'base64', value: base64Data }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  const data = await response.json();
  return parseApiResponse(data);
}

/**
 * 从 Canvas 检测岩点
 */
export async function detectFromCanvas(canvas: HTMLCanvasElement): Promise<RoboflowPrediction[]> {
  const base64 = canvas.toDataURL('image/jpeg', 0.85);
  return detectByBase64(base64);
}

/**
 * 从视频帧检测岩点
 */
export async function detectFromVideo(video: HTMLVideoElement): Promise<RoboflowPrediction[]> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  ctx.drawImage(video, 0, 0);
  return detectFromCanvas(canvas);
}

// ============ 结果处理 ============

/**
 * 按颜色分组检测结果
 */
export function groupByColor(predictions: RoboflowPrediction[]): Map<string, RoboflowPrediction[]> {
  const groups = new Map<string, RoboflowPrediction[]>();

  for (const pred of predictions) {
    const color = getMainColor(pred.class);
    if (!groups.has(color)) {
      groups.set(color, []);
    }
    groups.get(color)!.push(pred);
  }

  return groups;
}

/**
 * 为每个颜色组找到 Top 和 Start
 */
export function findRouteEndpoints(predictions: RoboflowPrediction[]): {
  top: RoboflowPrediction | null;
  start: RoboflowPrediction | null;
} {
  if (predictions.length === 0) {
    return { top: null, start: null };
  }

  // 按 Y 坐标排序 (Y 小 = 位置高)
  const sorted = [...predictions].sort((a, b) => a.y - b.y);

  return {
    top: sorted[0],           // 最高点
    start: sorted[sorted.length - 1]  // 最低点
  };
}

/**
 * 绘制检测结果到 Canvas
 */
export function drawPredictions(
  ctx: CanvasRenderingContext2D,
  predictions: RoboflowPrediction[],
  options: {
    drawPolygon?: boolean;
    drawBox?: boolean;
    drawLabel?: boolean;
  } = {}
) {
  const { drawPolygon = true, drawBox = false, drawLabel = true } = options;

  for (const pred of predictions) {
    const color = getMainColor(pred.class);

    // 绘制多边形轮廓 (如果有)
    if (drawPolygon && pred.points && pred.points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(pred.points[0].x, pred.points[0].y);
      for (let i = 1; i < pred.points.length; i++) {
        ctx.lineTo(pred.points[i].x, pred.points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = `${colorToHex(color)}40`; // 25% 透明度
      ctx.fill();
      ctx.strokeStyle = colorToHex(color);
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // 没有多边形，绘制边界框
      const x = pred.x - pred.width / 2;
      const y = pred.y - pred.height / 2;
      ctx.fillStyle = `${colorToHex(color)}40`;
      ctx.fillRect(x, y, pred.width, pred.height);
      ctx.strokeStyle = colorToHex(color);
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, pred.width, pred.height);
    }

    // 单独绘制边界框 (可选)
    if (drawBox && pred.points && pred.points.length > 0) {
      const x = pred.x - pred.width / 2;
      const y = pred.y - pred.height / 2;
      ctx.strokeStyle = colorToHex(color);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x, y, pred.width, pred.height);
      ctx.setLineDash([]);
    }

    // 绘制标签
    if (drawLabel) {
      const label = `${COLOR_NAMES[color] || color} ${(pred.confidence * 100).toFixed(0)}%`;
      const x = pred.x - pred.width / 2;
      const y = pred.y - pred.height / 2 - 5;
      
      // 背景
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const textWidth = ctx.measureText(label).width;
      ctx.fillRect(x - 2, y - 12, textWidth + 4, 14);
      
      // 文字
      ctx.fillStyle = colorToHex(color);
      ctx.font = 'bold 11px Arial';
      ctx.fillText(label, x, y);
    }
  }
}

/** 颜色名转 Hex */
function colorToHex(color: string): string {
  const map: Record<string, string> = {
    black: '#1a1a1a',
    blue: '#3b82f6',
    brown: '#a16207',
    cyan: '#06b6d4',
    gray: '#6b7280',
    green: '#22c55e',
    orange: '#f97316',
    pink: '#ec4899',
    purple: '#a855f7',
    red: '#ef4444',
    white: '#f5f5f5',
    yellow: '#eab308',
  };
  return map[color] || '#888888';
}

// ============ 颜色矫正 (重导出) ============

export { correctColors, COLOR_NAMES as COLOR_NAMES_CN } from '../logic/color_correction';
export type { CorrectedPrediction } from '../logic/color_correction';
