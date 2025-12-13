/**
 * 攀岩日报分析模块
 * 
 * 功能:
 * 1. 批量分析多个攀爬视频
 * 2. 统计完成/失败次数
 * 3. 统计不同颜色线路
 * 4. 生成日报总结
 * 5. 生成攀爬截图（中间图 + TOP图）
 * 
 * 成功判定: 双手同时触碰到 top 点
 */

import { detectHolds, HoldDetectionResult, DetectedHold, Route, drawDetectionResult } from './hold_detector';
import { PoseDetector } from './pose_detector';
import { Keypoint } from '../types';
import { drawKeypoints, drawSkeleton } from '../utils/drawing';

// ============ 类型定义 ============

export interface ClimbAttempt {
  id: string;
  videoName: string;
  routeColor: string;           // 线路颜色
  routeColorName: string;       // 线路颜色名称
  routeHoldCount: number;       // 线路岩点数量
  isSuccess: boolean;           // 是否成功 (双手触碰 top)
  topReachedTime?: number;      // 到达 top 的时间 (秒)
  duration: number;             // 攀爬时长 (秒)
  maxProgress: number;          // 最高进度 (0-100)
  thumbnail?: string;           // 缩略图 base64
  climbingImage?: string;       // 攀爬中间图 (带线路标注)
  topImage?: string;            // TOP图 (到顶瞬间，成功才有)
}

export interface DailyReport {
  date: string;
  totalAttempts: number;
  successCount: number;
  failCount: number;
  successRate: number;
  uniqueRoutes: number;
  routeBreakdown: RouteStats[];
  attempts: ClimbAttempt[];
  totalClimbTime: number;
}

export interface RouteStats {
  color: string;
  colorName: string;
  attempts: number;
  successes: number;
  successRate: number;
}

// ============ 颜色映射 ============

const COLOR_NAMES: Record<string, string> = {
  black: '黑色', blue: '蓝色', brown: '棕色', cyan: '青色',
  gray: '灰色', green: '绿色', orange: '橙色', pink: '粉色',
  purple: '紫色', red: '红色', white: '白色', yellow: '黄色',
};

const COLOR_HEX: Record<string, string> = {
  black: '#1a1a1a', blue: '#3b82f6', brown: '#a16207',
  cyan: '#06b6d4', gray: '#6b7280', green: '#22c55e',
  orange: '#f97316', pink: '#ec4899', purple: '#a855f7',
  red: '#ef4444', white: '#f5f5f5', yellow: '#eab308',
};

// ============ 进度回调 ============

interface AnalysisProgress {
  current: number;
  total: number;
  step: string;
  videoName: string;
}

type ProgressCallback = (progress: AnalysisProgress) => void;

// ============ 单视频分析 ============

/**
 * 分析单个攀爬视频
 * 
 * 策略：
 * 1. 先检测岩点（不判断线路）
 * 2. 用中间帧（1/3, 1/2, 2/3）检测人体姿态，这时人在墙上
 * 3. 基于中间帧的手脚位置判断正在攀爬的线路
 * 4. 然后检测是否到顶
 */
export async function analyzeClimbVideo(
  video: HTMLVideoElement,
  videoName: string,
  poseDetector: PoseDetector,
  onProgress?: ProgressCallback
): Promise<ClimbAttempt> {
  const attemptId = `climb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const duration = video.duration;
  
  onProgress?.({ current: 0, total: 100, step: '检测岩点...', videoName });
  
  // Step 1: 检测岩点 (不判断线路，由我们自己判断)
  const holdData = await detectHolds(video, poseDetector, {
    minConfidence: 0.5,
    detectActiveRoute: false  // 我们自己用中间帧判断
  });
  
  if (holdData.routes.length === 0) {
    const thumbnail = await captureThumbnail(video, duration * 0.3);
    return {
      id: attemptId,
      videoName,
      routeColor: 'unknown',
      routeColorName: '未知',
      routeHoldCount: 0,
      isSuccess: false,
      duration,
      maxProgress: 0,
      thumbnail
    };
  }
  
  onProgress?.({ current: 20, total: 100, step: '寻找人体...', videoName });
  
  // Step 2: 扫描视频找到人体出现的时间范围
  const humanTimeRange = await findHumanTimeRange(video, poseDetector);
  
  if (!humanTimeRange) {
    console.log('[ClimbReport] 未检测到人体');
    const thumbnail = await captureThumbnail(video, duration * 0.5);
    return {
      id: attemptId,
      videoName,
      routeColor: 'unknown',
      routeColorName: '未知',
      routeHoldCount: 0,
      isSuccess: false,
      duration,
      maxProgress: 0,
      thumbnail
    };
  }
  
  console.log(`[ClimbReport] 人体出现时间: ${humanTimeRange.start.toFixed(1)}s - ${humanTimeRange.end.toFixed(1)}s`);
  
  onProgress?.({ current: 35, total: 100, step: '分析攀爬线路...', videoName });
  
  // Step 3: 收集有效帧（必须同时检测到手和脚）
  const validFrames = await collectValidFrames(
    video,
    poseDetector,
    humanTimeRange,
    7  // 需要7个有效帧
  );
  
  if (validFrames.length < 3) {
    console.log(`[ClimbReport] 有效帧不足: ${validFrames.length}`);
    const thumbnail = await captureThumbnail(video, duration * 0.5);
    return {
      id: attemptId,
      videoName,
      routeColor: 'unknown',
      routeColorName: '未知',
      routeHoldCount: 0,
      isSuccess: false,
      duration,
      maxProgress: 0,
      thumbnail
    };
  }
  
  console.log(`[ClimbReport] 有效帧: ${validFrames.map(f => f.time.toFixed(1) + 's').join(', ')}`);
  
  // Step 4: 用有效帧判断线路
  const activeRoute = await detectActiveRouteFromValidFrames(
    video,
    poseDetector,
    holdData,
    validFrames
  );
  
  // 更新 middleFrameTimes 供后续使用
  const middleFrameTimes = validFrames.map(f => f.time);
  
  if (!activeRoute) {
    const thumbnail = await captureThumbnail(video, duration * 0.5);
    return {
      id: attemptId,
      videoName,
      routeColor: 'unknown',
      routeColorName: '未知',
      routeHoldCount: 0,
      isSuccess: false,
      duration,
      maxProgress: 0,
      thumbnail
    };
  }
  
  console.log(`[ClimbReport] 确定线路: ${activeRoute.colorName} (${activeRoute.holds.length} 个岩点)`);
  
  onProgress?.({ current: 40, total: 100, step: '分析攀爬过程...', videoName });
  
  // Step 3: 基于确定的线路，检测是否到顶
  const result = await detectTopReachWithCapture(
    video, 
    poseDetector, 
    holdData,
    activeRoute,
    middleFrameTimes,
    (p) => {
      onProgress?.({ 
        current: 40 + Math.round(p * 0.4), 
        total: 100, 
        step: '分析攀爬过程...', 
        videoName 
      });
    }
  );
  
  onProgress?.({ current: 85, total: 100, step: '生成截图...', videoName });
  
  // Step 4: 生成缩略图
  const thumbnail = await captureThumbnail(video, duration * 0.1);
  
  // Step 5: 生成攀爬中间图 (使用最佳攀爬时刻)
  const climbingImage = await captureClimbingImage(
    video,
    poseDetector,
    holdData,
    activeRoute,
    result.bestClimbTime || duration * 0.5
  );
  
  // Step 6: 如果成功，生成 TOP 图
  let topImage: string | undefined;
  if (result.success && result.reachTime) {
    topImage = await captureTopImage(
      video,
      poseDetector,
      holdData,
      activeRoute,
      result.reachTime
    );
  }
  
  onProgress?.({ current: 100, total: 100, step: '完成', videoName });
  
  return {
    id: attemptId,
    videoName,
    routeColor: activeRoute.color,
    routeColorName: activeRoute.colorName,
    routeHoldCount: activeRoute.holds.length,
    isSuccess: result.success,
    topReachedTime: result.reachTime,
    duration,
    maxProgress: result.maxProgress,
    thumbnail,
    climbingImage,
    topImage
  };
}

// ============ 有效帧类型 ============

interface ValidFrame {
  time: number;
  leftWrist: Keypoint;
  rightWrist: Keypoint;
  leftAnkle: Keypoint;
  rightAnkle: Keypoint;
}

/**
 * 收集有效帧：必须同时检测到双手和双脚
 */
async function collectValidFrames(
  video: HTMLVideoElement,
  poseDetector: PoseDetector,
  timeRange: { start: number; end: number },
  targetCount: number
): Promise<ValidFrame[]> {
  const validFrames: ValidFrame[] = [];
  const rangeLength = timeRange.end - timeRange.start;
  const sampleInterval = rangeLength / (targetCount * 3); // 多采样以找到足够的有效帧
  const minConfidence = 0.4;
  
  console.log(`[ClimbReport] 收集有效帧 (目标: ${targetCount} 帧, 采样间隔: ${sampleInterval.toFixed(1)}s)...`);
  
  let currentTime = timeRange.start;
  let attempts = 0;
  const maxAttempts = targetCount * 5; // 最多尝试次数
  
  while (validFrames.length < targetCount && currentTime < timeRange.end && attempts < maxAttempts) {
    video.currentTime = currentTime;
    await waitForSeek(video);
    
    const poses = await poseDetector.estimatePoses(video);
    attempts++;
    
    if (poses.length > 0) {
      const leftWrist = poses.find(p => p.name === 'left_wrist');
      const rightWrist = poses.find(p => p.name === 'right_wrist');
      const leftAnkle = poses.find(p => p.name === 'left_ankle');
      const rightAnkle = poses.find(p => p.name === 'right_ankle');
      
      // 必须同时检测到双手和双脚
      const hasHands = leftWrist && rightWrist && 
                       (leftWrist.score || 0) > minConfidence && 
                       (rightWrist.score || 0) > minConfidence;
      const hasFeet = leftAnkle && rightAnkle && 
                      (leftAnkle.score || 0) > minConfidence && 
                      (rightAnkle.score || 0) > minConfidence;
      
      if (hasHands && hasFeet) {
        validFrames.push({
          time: currentTime,
          leftWrist: leftWrist!,
          rightWrist: rightWrist!,
          leftAnkle: leftAnkle!,
          rightAnkle: rightAnkle!
        });
        console.log(`[ClimbReport]   ✓ ${currentTime.toFixed(1)}s: 有效帧 (${validFrames.length}/${targetCount})`);
        
        // 找到有效帧后，跳过一段时间避免重复
        currentTime += sampleInterval * 1.5;
      } else {
        console.log(`[ClimbReport]   ✗ ${currentTime.toFixed(1)}s: 手=${hasHands}, 脚=${hasFeet}`);
        currentTime += sampleInterval * 0.5;
      }
    } else {
      currentTime += sampleInterval * 0.5;
    }
  }
  
  console.log(`[ClimbReport] 收集到 ${validFrames.length} 个有效帧`);
  return validFrames;
}

/**
 * 用有效帧判断正在攀爬的线路
 * 判断逻辑：手脚和岩点的重合
 */
async function detectActiveRouteFromValidFrames(
  video: HTMLVideoElement,
  poseDetector: PoseDetector,
  holdData: HoldDetectionResult,
  validFrames: ValidFrame[]
): Promise<Route | null> {
  const colorVotes = new Map<string, { handVotes: number; footVotes: number; total: number }>();
  const touchThreshold = 80;
  
  console.log(`[ClimbReport] 分析 ${validFrames.length} 个有效帧的手脚触点...`);
  
  for (const frame of validFrames) {
    // 检查每个肢体接触的岩点
    const limbs = [
      { name: '左手', kp: frame.leftWrist, isHand: true },
      { name: '右手', kp: frame.rightWrist, isHand: true },
      { name: '左脚', kp: frame.leftAnkle, isHand: false },
      { name: '右脚', kp: frame.rightAnkle, isHand: false },
    ];
    
    const frameTouches: string[] = [];
    
    for (const limb of limbs) {
      const touched = findNearestHoldInRoute(limb.kp, holdData.allHolds, touchThreshold);
      if (touched) {
        frameTouches.push(`${limb.name}→${touched.color}`);
        
        // 累计投票
        let votes = colorVotes.get(touched.color);
        if (!votes) {
          votes = { handVotes: 0, footVotes: 0, total: 0 };
          colorVotes.set(touched.color, votes);
        }
        
        if (limb.isHand) {
          votes.handVotes++;
        } else {
          votes.footVotes++;
        }
        votes.total++;
      }
    }
    
    console.log(`[ClimbReport]   ${frame.time.toFixed(1)}s: [${frameTouches.join(', ')}]`);
  }
  
  // 输出投票结果
  console.log('[ClimbReport] 投票结果:');
  for (const [color, votes] of colorVotes) {
    console.log(`[ClimbReport]   ${color}: 手=${votes.handVotes}, 脚=${votes.footVotes}, 总=${votes.total}`);
  }
  
  // 选择最佳线路
  // 条件：1) 总票数最高 2) 必须同时有手和脚的投票
  let bestColor: string | null = null;
  let bestScore = 0;
  
  for (const [color, votes] of colorVotes) {
    // 必须同时有手和脚触碰才算有效
    if (votes.handVotes > 0 && votes.footVotes > 0) {
      const score = votes.total;
      if (score > bestScore) {
        bestScore = score;
        bestColor = color;
      }
    }
  }
  
  if (bestColor) {
    const route = holdData.routes.find(r => r.color === bestColor);
    if (route) {
      const votes = colorVotes.get(bestColor)!;
      console.log(`[ClimbReport] ✓ 确定线路: ${route.colorName} (手=${votes.handVotes}, 脚=${votes.footVotes})`);
      return route;
    }
  }
  
  console.log('[ClimbReport] ✗ 无法确定线路 (需要同时有手和脚触碰)');
  return null;
}

/**
 * 扫描视频找到人体出现的时间范围
 * 通过快速采样找到人体出现的起止时间
 */
async function findHumanTimeRange(
  video: HTMLVideoElement,
  poseDetector: PoseDetector
): Promise<{ start: number; end: number } | null> {
  const duration = video.duration;
  const sampleInterval = 2; // 每2秒采样一次
  const samples = Math.floor(duration / sampleInterval);
  
  let firstHumanTime: number | null = null;
  let lastHumanTime: number | null = null;
  
  console.log(`[ClimbReport] 扫描人体出现时间 (${samples} 个采样点)...`);
  
  for (let i = 0; i < samples; i++) {
    const time = i * sampleInterval + 0.5; // 加0.5避免开头黑屏
    video.currentTime = time;
    await waitForSeek(video);
    
    const poses = await poseDetector.estimatePoses(video);
    
    // 检测到人体的条件：至少有5个关键点置信度>0.3
    if (poses.length > 0) {
      const validKeypoints = poses.filter(p => (p.score || 0) > 0.3).length;
      
      if (validKeypoints >= 5) {
        if (firstHumanTime === null) {
          firstHumanTime = time;
        }
        lastHumanTime = time;
      }
    }
  }
  
  if (firstHumanTime === null || lastHumanTime === null) {
    return null;
  }
  
  // 稍微扩展范围，确保不会错过关键时刻
  const start = Math.max(0, firstHumanTime - 1);
  const end = Math.min(duration, lastHumanTime + 1);
  
  return { start, end };
}

/**
 * 用中间帧判断正在攀爬的线路
 * 只使用人在墙上的帧（中间帧）来判断
 */
async function detectActiveRouteFromMiddleFrames(
  video: HTMLVideoElement,
  poseDetector: PoseDetector,
  holdData: HoldDetectionResult,
  middleFrameTimes: number[]
): Promise<Route | null> {
  const colorVotes = new Map<string, number>();
  const touchThreshold = 80; // 接触判定距离
  
  console.log(`[ClimbReport] 使用 ${middleFrameTimes.length} 个中间帧判断线路...`);
  
  for (const time of middleFrameTimes) {
    video.currentTime = time;
    await waitForSeek(video);
    
    // 检测姿态
    const poses = await poseDetector.estimatePoses(video);
    if (poses.length === 0) {
      console.log(`[ClimbReport]   ${time.toFixed(1)}s: 未检测到人体`);
      continue;
    }
    
    // 获取四肢位置
    const limbs = [
      { name: 'left_wrist', kp: poses.find(p => p.name === 'left_wrist') },
      { name: 'right_wrist', kp: poses.find(p => p.name === 'right_wrist') },
      { name: 'left_ankle', kp: poses.find(p => p.name === 'left_ankle') },
      { name: 'right_ankle', kp: poses.find(p => p.name === 'right_ankle') },
    ].filter(l => l.kp && (l.kp.score || 0) > 0.3);
    
    // 检测每个肢体接触的岩点
    const touchedColors: string[] = [];
    for (const limb of limbs) {
      if (!limb.kp) continue;
      
      const touched = findNearestHoldInRoute(limb.kp, holdData.allHolds, touchThreshold);
      if (touched) {
        touchedColors.push(touched.color);
        const votes = colorVotes.get(touched.color) || 0;
        colorVotes.set(touched.color, votes + 1);
      }
    }
    
    console.log(`[ClimbReport]   ${time.toFixed(1)}s: 检测到肢体 ${limbs.length} 个, 接触颜色: [${touchedColors.join(', ')}]`);
  }
  
  // 找票数最多的颜色
  let maxVotes = 0;
  let activeColor: string | null = null;
  
  for (const [color, votes] of colorVotes) {
    console.log(`[ClimbReport]   颜色投票: ${color} = ${votes}`);
    if (votes > maxVotes) {
      maxVotes = votes;
      activeColor = color;
    }
  }
  
  if (activeColor && maxVotes >= 2) { // 至少2票才算有效
    const route = holdData.routes.find(r => r.color === activeColor);
    if (route) {
      console.log(`[ClimbReport] 确定线路: ${activeColor} (票数: ${maxVotes})`);
      return route;
    }
  }
  
  console.log('[ClimbReport] 无法确定线路 (投票不足)');
  return null;
}

/**
 * 找最近的岩点
 */
function findNearestHoldInRoute(
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

/**
 * 检测是否双手触碰 top 点，并记录最佳攀爬时刻
 * 从中间帧时间开始检测（确保人在墙上）
 */
async function detectTopReachWithCapture(
  video: HTMLVideoElement,
  poseDetector: PoseDetector,
  holdData: HoldDetectionResult,
  activeRoute: Route,
  middleFrameTimes: number[],
  onProgress?: (progress: number) => void
): Promise<{ 
  success: boolean; 
  reachTime?: number; 
  maxProgress: number;
  bestClimbTime?: number;
}> {
  const topHold = activeRoute.topHold;
  if (!topHold) {
    return { success: false, maxProgress: 0 };
  }
  
  const duration = video.duration;
  const sampleInterval = 0.5;
  const touchThreshold = 70;  // 到顶判定距离
  
  let success = false;
  let reachTime: number | undefined;
  let maxProgress = 0;
  let bestClimbTime = middleFrameTimes[1] || duration * 0.5; // 默认用中间帧
  let bestClimbProgress = 0;
  
  // 从第一个中间帧开始检测（确保人已经上墙）
  const startTime = Math.min(...middleFrameTimes) - 2; // 往前2秒开始
  const endTime = duration - 0.3;
  const samples = Math.floor((endTime - startTime) / sampleInterval);
  
  console.log(`[ClimbReport] 检测到顶: ${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s, TOP点: (${topHold.x.toFixed(0)}, ${topHold.y.toFixed(0)})`);
  
  for (let i = 0; i < samples; i++) {
    const time = startTime + i * sampleInterval;
    if (time < 0) continue;
    
    video.currentTime = time;
    await waitForSeek(video);
    
    const poses = await poseDetector.estimatePoses(video);
    if (poses.length === 0) continue;
    
    const leftWrist = poses.find(p => p.name === 'left_wrist');
    const rightWrist = poses.find(p => p.name === 'right_wrist');
    
    // 只有双手都检测到才计算
    if (!leftWrist || !rightWrist) continue;
    if ((leftWrist.score || 0) < 0.3 || (rightWrist.score || 0) < 0.3) continue;
    
    const leftDist = distance(leftWrist, topHold);
    const rightDist = distance(rightWrist, topHold);
    
    // 计算进度 (基于手的高度相对于 top 的位置)
    const handY = Math.min(leftWrist.y, rightWrist.y);
    const topY = topHold.y;
    const startY = activeRoute.startHold?.y || video.videoHeight;
    
    // 进度 = (起点Y - 手Y) / (起点Y - 顶点Y) * 100
    const progress = Math.max(0, Math.min(100, 
      ((startY - handY) / (startY - topY)) * 100
    ));
    
    if (progress > maxProgress) {
      maxProgress = progress;
    }
    
    // 记录最佳攀爬时刻 (进度40-85%之间)
    if (progress > bestClimbProgress && progress >= 40 && progress <= 85) {
      bestClimbProgress = progress;
      bestClimbTime = time;
    }
    
    // 判断是否双手都触碰 top
    if (leftDist < touchThreshold && rightDist < touchThreshold) {
      console.log(`[ClimbReport] 🎉 到顶! time=${time.toFixed(1)}s, leftDist=${leftDist.toFixed(0)}, rightDist=${rightDist.toFixed(0)}`);
      success = true;
      reachTime = time;
      maxProgress = 100;
      break;
    }
    
    onProgress?.(i / samples);
  }
  
  console.log(`[ClimbReport] 检测结果: success=${success}, maxProgress=${maxProgress.toFixed(0)}%, bestClimbTime=${bestClimbTime.toFixed(1)}s`);
  
  return { success, reachTime, maxProgress, bestClimbTime };
}

/**
 * 生成攀爬中间图 (带线路标注和姿态)
 */
async function captureClimbingImage(
  video: HTMLVideoElement,
  poseDetector: PoseDetector,
  holdData: HoldDetectionResult,
  activeRoute: Route,
  time: number
): Promise<string> {
  video.currentTime = time;
  await waitForSeek(video);
  
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  
  // 绘制视频帧
  ctx.drawImage(video, 0, 0);
  
  // 绘制线路标注 (高亮当前线路)
  drawDetectionResult(ctx, holdData, {
    highlightRoute: activeRoute.color,
    showLabels: true,
    showPolygon: true
  });
  
  // 检测并绘制姿态
  const poses = await poseDetector.estimatePoses(video);
  if (poses.length > 0) {
    drawKeypoints(ctx, poses);
    drawSkeleton(ctx, poses);
  }
  
  // 绘制线路信息标签
  drawRouteLabel(ctx, activeRoute, '攀爬中');
  
  // 缩小输出
  return scaleCanvas(canvas, 0.5);
}

/**
 * 生成 TOP 图 (到顶瞬间)
 */
async function captureTopImage(
  video: HTMLVideoElement,
  poseDetector: PoseDetector,
  holdData: HoldDetectionResult,
  activeRoute: Route,
  reachTime: number
): Promise<string> {
  video.currentTime = reachTime;
  await waitForSeek(video);
  
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  
  // 绘制视频帧
  ctx.drawImage(video, 0, 0);
  
  // 绘制线路标注
  drawDetectionResult(ctx, holdData, {
    highlightRoute: activeRoute.color,
    showLabels: true,
    showPolygon: true
  });
  
  // 检测并绘制姿态
  const poses = await poseDetector.estimatePoses(video);
  if (poses.length > 0) {
    drawKeypoints(ctx, poses);
    drawSkeleton(ctx, poses);
  }
  
  // 绘制成功标签
  drawRouteLabel(ctx, activeRoute, '🎉 TOP!');
  
  // 绘制成功特效
  drawSuccessEffect(ctx, activeRoute.topHold);
  
  return scaleCanvas(canvas, 0.5);
}

/**
 * 绘制线路信息标签
 */
function drawRouteLabel(ctx: CanvasRenderingContext2D, route: Route, status: string) {
  const color = COLOR_HEX[route.color] || '#888';
  const text = `${route.colorName}线 ${status}`;
  
  // 背景
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(10, 10, 180, 40);
  
  // 颜色指示器
  ctx.fillStyle = color;
  ctx.fillRect(15, 18, 24, 24);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(15, 18, 24, 24);
  
  // 文字
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px Arial';
  ctx.fillText(text, 48, 38);
}

/**
 * 绘制成功特效
 */
function drawSuccessEffect(ctx: CanvasRenderingContext2D, topHold: DetectedHold | null) {
  if (!topHold) return;
  
  // 光环效果
  const gradient = ctx.createRadialGradient(
    topHold.x, topHold.y, 0,
    topHold.x, topHold.y, 80
  );
  gradient.addColorStop(0, 'rgba(255, 215, 0, 0.8)');
  gradient.addColorStop(0.5, 'rgba(255, 215, 0, 0.3)');
  gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
  
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(topHold.x, topHold.y, 80, 0, Math.PI * 2);
  ctx.fill();
  
  // 星星装饰
  ctx.fillStyle = '#FFD700';
  ctx.font = '30px Arial';
  ctx.fillText('⭐', topHold.x - 50, topHold.y - 40);
  ctx.fillText('⭐', topHold.x + 30, topHold.y - 50);
  ctx.fillText('✨', topHold.x - 30, topHold.y - 60);
}

/**
 * 等待视频 seek 完成
 */
function waitForSeek(video: HTMLVideoElement): Promise<void> {
  return new Promise(resolve => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
  });
}

/**
 * 缩放 Canvas
 */
function scaleCanvas(canvas: HTMLCanvasElement, scale: number): string {
  const scaled = document.createElement('canvas');
  scaled.width = canvas.width * scale;
  scaled.height = canvas.height * scale;
  
  const ctx = scaled.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  
  return scaled.toDataURL('image/jpeg', 0.8);
}

/**
 * 计算两点距离
 */
function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

/**
 * 生成视频缩略图
 */
async function captureThumbnail(video: HTMLVideoElement, time: number): Promise<string> {
  video.currentTime = time;
  await waitForSeek(video);
  
  const canvas = document.createElement('canvas');
  const scale = 0.25;
  canvas.width = video.videoWidth * scale;
  canvas.height = video.videoHeight * scale;
  
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  return canvas.toDataURL('image/jpeg', 0.6);
}

// ============ 批量分析 ============

export async function generateDailyReport(
  videos: Array<{ video: HTMLVideoElement; name: string }>,
  poseDetector: PoseDetector,
  onProgress?: (current: number, total: number, videoName: string, step: string) => void
): Promise<DailyReport> {
  const attempts: ClimbAttempt[] = [];
  
  for (let i = 0; i < videos.length; i++) {
    const { video, name } = videos[i];
    
    onProgress?.(i + 1, videos.length, name, '分析中...');
    
    try {
      const attempt = await analyzeClimbVideo(video, name, poseDetector, (p) => {
        onProgress?.(i + 1, videos.length, name, p.step);
      });
      attempts.push(attempt);
    } catch (e) {
      console.error(`分析视频 ${name} 失败:`, e);
      attempts.push({
        id: `failed-${i}`,
        videoName: name,
        routeColor: 'unknown',
        routeColorName: '未知',
        routeHoldCount: 0,
        isSuccess: false,
        duration: 0,
        maxProgress: 0
      });
    }
  }
  
  return compileReport(attempts);
}

function compileReport(attempts: ClimbAttempt[]): DailyReport {
  const today = new Date().toISOString().split('T')[0];
  
  const successAttempts = attempts.filter(a => a.isSuccess);
  const failAttempts = attempts.filter(a => !a.isSuccess);
  
  const colorMap = new Map<string, { attempts: number; successes: number }>();
  
  for (const attempt of attempts) {
    if (attempt.routeColor === 'unknown') continue;
    
    const stats = colorMap.get(attempt.routeColor) || { attempts: 0, successes: 0 };
    stats.attempts++;
    if (attempt.isSuccess) stats.successes++;
    colorMap.set(attempt.routeColor, stats);
  }
  
  const routeBreakdown: RouteStats[] = [];
  for (const [color, stats] of colorMap) {
    routeBreakdown.push({
      color,
      colorName: COLOR_NAMES[color] || color,
      attempts: stats.attempts,
      successes: stats.successes,
      successRate: stats.attempts > 0 ? Math.round((stats.successes / stats.attempts) * 100) : 0
    });
  }
  
  routeBreakdown.sort((a, b) => b.attempts - a.attempts);
  
  const totalClimbTime = attempts.reduce((sum, a) => sum + a.duration, 0);
  
  return {
    date: today,
    totalAttempts: attempts.length,
    successCount: successAttempts.length,
    failCount: failAttempts.length,
    successRate: attempts.length > 0 
      ? Math.round((successAttempts.length / attempts.length) * 100) 
      : 0,
    uniqueRoutes: colorMap.size,
    routeBreakdown,
    attempts,
    totalClimbTime
  };
}

// ============ 格式化工具 ============

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatTotalTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}小时${mins}分钟`;
  }
  return `${mins}分钟`;
}
