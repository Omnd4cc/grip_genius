/**
 * 视频分析器
 * 
 * 整合 Phase 1 (岩点检测) 和 Phase 2 (姿态分析)
 */

import { 
  detectHoldsFromVideo, 
  HoldDetectionResult, 
  DetectedHold,
  Route,
  toHoldArray 
} from './hold_detection_pipeline';
import { PoseDetector } from './pose_detector';
import { ActionRecognizer } from './recognizer';
import { BetaGenerator } from './beta_generator';
import { Keypoint, BetaAction, Hold } from '../types';

export interface AnalysisResult {
  holds: HoldDetectionResult;
  activeRoute: Route | null;
  betaSequence: BetaAction[];
  betaText: string[];
}

export class VideoAnalyzer {
  private poseDetector: PoseDetector;
  private recognizer: ActionRecognizer;
  private generator: BetaGenerator;
  
  // 缓存的岩点检测结果 (Phase 1 的结果，只计算一次)
  private holdCache: HoldDetectionResult | null = null;
  private activeRoute: Route | null = null;
  
  constructor() {
    this.poseDetector = new PoseDetector();
    this.recognizer = new ActionRecognizer();
    this.generator = new BetaGenerator();
  }
  
  async initialize() {
    await this.poseDetector.initialize();
  }
  
  /**
   * Phase 1: 岩点检测
   * 只需要调用一次，结果会被缓存
   */
  async detectHolds(video: HTMLVideoElement): Promise<HoldDetectionResult> {
    console.log('[VideoAnalyzer] Phase 1: 岩点检测');
    this.holdCache = await detectHoldsFromVideo(video);
    return this.holdCache;
  }
  
  /**
   * Phase 2: 逐帧姿态分析
   */
  async analyzeFrame(
    video: HTMLVideoElement,
    ctx: CanvasRenderingContext2D
  ): Promise<{
    pose: Keypoint[];
    activeRoute: Route | null;
    currentAction: string | null;
  }> {
    if (!this.holdCache) {
      console.warn('[VideoAnalyzer] 请先调用 detectHolds()');
      return { pose: [], activeRoute: null, currentAction: null };
    }
    
    // 1. 姿态检测
    const pose = await this.poseDetector.estimatePoses(video);
    
    // 2. 确定当前线路 (基于手接触的岩点颜色)
    if (!this.activeRoute && pose.length > 0) {
      this.activeRoute = this.determineActiveRoute(pose);
    }
    
    // 3. 更新动作状态机
    const holds = toHoldArray(this.holdCache);
    this.recognizer.update(pose, holds, video.currentTime * 1000);
    
    // 4. 获取最新动作
    const sequence = this.recognizer.getBetaSequence();
    const lastAction = sequence.length > 0 ? sequence[sequence.length - 1] : null;
    
    return {
      pose,
      activeRoute: this.activeRoute,
      currentAction: lastAction?.description || null
    };
  }
  
  /**
   * 根据人手接触的岩点确定当前线路
   */
  private determineActiveRoute(pose: Keypoint[]): Route | null {
    if (!this.holdCache) return null;
    
    const wrists = pose.filter(p => 
      p.name?.includes('wrist') && (p.score || 0) > 0.5
    );
    
    for (const wrist of wrists) {
      for (const hold of this.holdCache.allHolds) {
        const dist = Math.sqrt(
          Math.pow(wrist.x - (hold.x + hold.width / 2), 2) +
          Math.pow(wrist.y - (hold.y + hold.height / 2), 2)
        );
        
        // 如果手在岩点附近
        if (dist < hold.width + 30) {
          const colorName = hold.colorName || 'unknown';
          const route = this.holdCache.routes.get(colorName);
          
          if (route) {
            console.log(`[VideoAnalyzer] 确定当前线路: ${colorName}`);
            return route;
          }
        }
      }
    }
    
    return null;
  }
  
  /**
   * 获取完整分析结果
   */
  getResult(): AnalysisResult {
    const sequence = this.recognizer.getBetaSequence();
    
    return {
      holds: this.holdCache!,
      activeRoute: this.activeRoute,
      betaSequence: sequence,
      betaText: this.generator.generateText({ 
        actions: sequence, 
        totalTime: 0 
      })
    };
  }
  
  /**
   * 重置分析器状态
   */
  reset() {
    this.holdCache = null;
    this.activeRoute = null;
    this.recognizer.reset();
  }
  
  /**
   * 获取缓存的岩点
   */
  getHolds(): DetectedHold[] {
    return this.holdCache?.allHolds || [];
  }
  
  /**
   * 获取所有线路
   */
  getRoutes(): Map<string, Route> {
    return this.holdCache?.routes || new Map();
  }
}

