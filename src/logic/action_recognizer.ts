/**
 * 动作识别器
 * 
 * Phase 2: 实时分析人体姿态，识别动作
 * 
 * 功能:
 * 1. 追踪四肢触碰的岩点
 * 2. 自动确定当前线路
 * 3. 识别高阶动作 (Heel Hook, Crossover)
 * 4. 追踪攀爬进度
 */

import { Keypoint, Hold, BetaAction, Limb } from '../types';
import { HoldDetectionResult, Route, DetectedHold } from './hold_detector';
import { distance, angle } from '../utils/geometry';

// ============ 类型定义 ============

interface LimbState {
  limb: Limb;
  state: 'idle' | 'moving' | 'holding';
  holdId?: string;
  lastPos: { x: number; y: number };
}

export interface AnalysisState {
  activeRoute: Route | null;
  progress: number;
  touchedHolds: Set<string>;
  limbStates: Map<Limb, LimbState>;
  betaSequence: BetaAction[];
}

// ============ 主类 ============

export class ActionRecognizer {
  private holdData: HoldDetectionResult | null = null;
  private state: AnalysisState;
  private startTime: number = 0;
  
  constructor() {
    this.state = this.createInitialState();
  }
  
  private createInitialState(): AnalysisState {
    return {
      activeRoute: null,
      progress: 0,
      touchedHolds: new Set(),
      limbStates: new Map([
        ['leftHand', { limb: 'leftHand', state: 'idle', lastPos: { x: 0, y: 0 } }],
        ['rightHand', { limb: 'rightHand', state: 'idle', lastPos: { x: 0, y: 0 } }],
        ['leftFoot', { limb: 'leftFoot', state: 'idle', lastPos: { x: 0, y: 0 } }],
        ['rightFoot', { limb: 'rightFoot', state: 'idle', lastPos: { x: 0, y: 0 } }],
      ]),
      betaSequence: []
    };
  }
  
  /**
   * 设置岩点数据 (Phase 1 的输出)
   */
  setHoldData(data: HoldDetectionResult) {
    this.holdData = data;
    this.reset();
  }
  
  /**
   * 每帧更新
   */
  update(pose: Keypoint[], timestamp: number): AnalysisState {
    if (!this.holdData || pose.length === 0) return this.state;
    
    if (this.startTime === 0) this.startTime = timestamp;
    
    // 提取四肢关键点
    const limbs = this.extractLimbs(pose);
    
    // 更新每个肢体状态
    for (const [limb, kp] of Object.entries(limbs)) {
      if (kp) {
        this.updateLimb(limb as Limb, kp, timestamp);
      }
    }
    
    // 检测高阶动作
    this.detectAdvancedMoves(pose, timestamp);
    
    // 更新进度
    this.updateProgress();
    
    return this.state;
  }
  
  /**
   * 提取四肢关键点
   */
  private extractLimbs(pose: Keypoint[]): Record<Limb, Keypoint | null> {
    const get = (name: string) => {
      const kp = pose.find(p => p.name === name);
      return kp && (kp.score || 0) > 0.3 ? kp : null;
    };
    return {
      leftHand: get('left_wrist'),
      rightHand: get('right_wrist'),
      leftFoot: get('left_ankle'),
      rightFoot: get('right_ankle')
    };
  }
  
  /**
   * 更新单个肢体状态
   */
  private updateLimb(limb: Limb, kp: Keypoint, timestamp: number) {
    const state = this.state.limbStates.get(limb)!;
    const velocity = distance(kp, state.lastPos);
    
    const MOVE_THRESHOLD = 3;
    const HOLD_DISTANCE = 40;
    
    // 状态转换
    if (velocity > MOVE_THRESHOLD) {
      state.state = 'moving';
      state.holdId = undefined;
    } else {
      // 检查是否在岩点上
      const nearest = this.findNearestHold(kp);
      
      if (nearest && nearest.dist < HOLD_DISTANCE) {
        const wasHolding = state.state === 'holding' && state.holdId === nearest.hold.id;
        
        if (!wasHolding) {
          state.state = 'holding';
          state.holdId = nearest.hold.id;
          this.state.touchedHolds.add(nearest.hold.id);
          
          // 记录动作
          this.recordAction({
            id: `${timestamp}-${limb}`,
            timestamp: (timestamp - this.startTime) / 1000,
            type: limb.includes('Hand') ? 'Grab' : 'Step',
            limb,
            holdId: nearest.hold.id,
            description: `${this.limbName(limb)} ${limb.includes('Hand') ? '抓握' : '踩踏'} ${nearest.hold.id}`
          });
          
          // 确定线路
          if (!this.state.activeRoute) {
            this.state.activeRoute = this.findRouteByHold(nearest.hold.id);
          }
        }
      }
    }
    
    state.lastPos = { x: kp.x, y: kp.y };
  }
  
  /**
   * 检测高阶动作
   */
  private detectAdvancedMoves(pose: Keypoint[], timestamp: number) {
    // Heel Hook 检测
    this.detectHeelHook(pose, 'left', timestamp);
    this.detectHeelHook(pose, 'right', timestamp);
    
    // Crossover 检测
    this.detectCrossover(pose, timestamp);
  }
  
  private detectHeelHook(pose: Keypoint[], side: 'left' | 'right', timestamp: number) {
    const hip = pose.find(p => p.name === `${side}_hip`);
    const knee = pose.find(p => p.name === `${side}_knee`);
    const ankle = pose.find(p => p.name === `${side}_ankle`);
    const limb: Limb = `${side}Foot`;
    const state = this.state.limbStates.get(limb)!;
    
    if (hip && knee && ankle && state.state === 'holding') {
      const kneeAngle = angle(hip, knee, ankle);
      
      // 膝盖角度 < 120° 且脚踝高于膝盖
      if (kneeAngle < 120 && ankle.y < knee.y + 20) {
        if (!this.lastActionIs(limb, 'HeelHook')) {
          this.recordAction({
            id: `hh-${timestamp}`,
            timestamp: (timestamp - this.startTime) / 1000,
            type: 'HeelHook',
            limb,
            holdId: state.holdId || '?',
            description: `${side === 'left' ? '左' : '右'}脚 挂脚 (Heel Hook) ${state.holdId}`
          });
        }
      }
    }
  }
  
  private detectCrossover(pose: Keypoint[], timestamp: number) {
    const nose = pose.find(p => p.name === 'nose');
    const rWrist = pose.find(p => p.name === 'right_wrist');
    const state = this.state.limbStates.get('rightHand')!;
    
    if (nose && rWrist && state.state === 'holding') {
      // 右手在鼻子左侧 = 交叉
      if (rWrist.x < nose.x - 30) {
        if (!this.lastActionIs('rightHand', 'Crossover')) {
          this.recordAction({
            id: `co-${timestamp}`,
            timestamp: (timestamp - this.startTime) / 1000,
            type: 'Crossover',
            limb: 'rightHand',
            holdId: state.holdId || '?',
            description: `右手 交叉手 (Crossover) ${state.holdId}`
          });
        }
      }
    }
  }
  
  /**
   * 更新攀爬进度
   */
  private updateProgress() {
    if (!this.state.activeRoute) {
      this.state.progress = 0;
      return;
    }
    
    const route = this.state.activeRoute;
    const routeHoldIds = new Set(route.holds.map(h => h.id));
    
    let touched = 0;
    for (const id of this.state.touchedHolds) {
      if (routeHoldIds.has(id)) touched++;
    }
    
    this.state.progress = Math.round((touched / route.holds.length) * 100);
    
    // 触碰 Top = 100%
    if (route.topHold && this.state.touchedHolds.has(route.topHold.id)) {
      this.state.progress = 100;
    }
  }
  
  // ============ 辅助方法 ============
  
  private findNearestHold(pt: Keypoint): { hold: DetectedHold; dist: number } | null {
    if (!this.holdData) return null;
    
    let nearest: DetectedHold | null = null;
    let minDist = Infinity;
    
    for (const hold of this.holdData.allHolds) {
      const cx = hold.x + hold.width / 2;
      const cy = hold.y + hold.height / 2;
      const dist = Math.sqrt(Math.pow(pt.x - cx, 2) + Math.pow(pt.y - cy, 2));
      
      if (dist < minDist) {
        minDist = dist;
        nearest = hold;
      }
    }
    
    return nearest ? { hold: nearest, dist: minDist } : null;
  }
  
  private findRouteByHold(holdId: string): Route | null {
    if (!this.holdData) return null;
    return this.holdData.routes.find(r => r.holds.some(h => h.id === holdId)) || null;
  }
  
  private recordAction(action: BetaAction) {
    this.state.betaSequence.push(action);
    console.log('[ActionRecognizer]', action.description);
  }
  
  private lastActionIs(limb: Limb, type: string): boolean {
    const last = this.state.betaSequence.filter(a => a.limb === limb).pop();
    return last?.type === type;
  }
  
  private limbName(limb: Limb): string {
    const map: Record<Limb, string> = {
      leftHand: '左手', rightHand: '右手',
      leftFoot: '左脚', rightFoot: '右脚'
    };
    return map[limb];
  }
  
  // ============ 公开方法 ============
  
  getState(): AnalysisState { return this.state; }
  getBetaSequence(): BetaAction[] { return this.state.betaSequence; }
  getActiveRoute(): Route | null { return this.state.activeRoute; }
  getProgress(): number { return this.state.progress; }
  
  getHint(): string {
    if (!this.state.activeRoute) return '等待检测线路...';
    const route = this.state.activeRoute;
    if (this.state.progress === 100) return `🎉 完成 ${route.color} 线路!`;
    return `${route.color} 线路 ${this.state.progress}%`;
  }
  
  reset() {
    this.state = this.createInitialState();
    this.startTime = 0;
  }
}

