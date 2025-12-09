/**
 * 线路分析器
 * 
 * 职责：
 * 1. 根据人体姿态确定当前线路
 * 2. 追踪攀爬进度
 * 3. 生成实时提示
 */

import { Keypoint, Hold, BetaAction, Limb } from '../types';
import { HoldDetectionResult, RouteGroup } from './hold_detector';

export interface RouteAnalysisState {
  activeRoute: RouteGroup | null;        // 当前线路
  touchedHolds: Set<string>;             // 已触碰的岩点
  currentActions: Map<Limb, Hold | null>; // 当前四肢所在的岩点
  progress: number;                       // 攀爬进度 0-100
}

export class RouteAnalyzer {
  private holdData: HoldDetectionResult | null = null;
  private state: RouteAnalysisState = {
    activeRoute: null,
    touchedHolds: new Set(),
    currentActions: new Map([
      ['leftHand', null],
      ['rightHand', null],
      ['leftFoot', null],
      ['rightFoot', null]
    ]),
    progress: 0
  };
  
  /**
   * 设置岩点检测结果 (Phase 1 的输出)
   */
  setHoldData(data: HoldDetectionResult) {
    this.holdData = data;
    this.reset();
    console.log('[RouteAnalyzer] 已加载岩点数据:', data.allHolds.length, '个岩点,', data.routes.length, '条线路');
  }
  
  /**
   * 更新分析状态 (每帧调用)
   */
  update(pose: Keypoint[]): RouteAnalysisState {
    if (!this.holdData) return this.state;
    
    // 获取四肢关键点
    const limbs = this.extractLimbs(pose);
    
    // 检测每个肢体触碰的岩点
    for (const [limb, point] of Object.entries(limbs)) {
      if (!point) continue;
      
      const touchedHold = this.findTouchedHold(point);
      this.state.currentActions.set(limb as Limb, touchedHold);
      
      if (touchedHold) {
        this.state.touchedHolds.add(touchedHold.id);
        
        // 如果还没确定线路，根据触碰的岩点确定
        if (!this.state.activeRoute) {
          this.state.activeRoute = this.findRouteByHold(touchedHold);
          if (this.state.activeRoute) {
            console.log('[RouteAnalyzer] 确定当前线路:', this.state.activeRoute.colorName);
          }
        }
      }
    }
    
    // 更新进度
    this.updateProgress();
    
    return this.state;
  }
  
  /**
   * 提取四肢关键点
   */
  private extractLimbs(pose: Keypoint[]): Record<Limb, Keypoint | null> {
    const find = (name: string) => {
      const kp = pose.find(p => p.name === name);
      return kp && (kp.score || 0) > 0.3 ? kp : null;
    };
    
    return {
      leftHand: find('left_wrist'),
      rightHand: find('right_wrist'),
      leftFoot: find('left_ankle'),
      rightFoot: find('right_ankle')
    };
  }
  
  /**
   * 查找触碰的岩点
   */
  private findTouchedHold(point: Keypoint): Hold | null {
    if (!this.holdData) return null;
    
    const TOUCH_THRESHOLD = 40; // 像素距离阈值
    
    let nearest: Hold | null = null;
    let minDist = Infinity;
    
    for (const hold of this.holdData.allHolds) {
      const dist = Math.sqrt(
        Math.pow(point.x - hold.x, 2) + 
        Math.pow(point.y - hold.y, 2)
      );
      
      if (dist < TOUCH_THRESHOLD && dist < minDist) {
        minDist = dist;
        nearest = hold;
      }
    }
    
    return nearest;
  }
  
  /**
   * 根据岩点找到所属线路
   */
  private findRouteByHold(hold: Hold): RouteGroup | null {
    if (!this.holdData) return null;
    
    for (const route of this.holdData.routes) {
      if (route.holds.some(h => h.id === hold.id)) {
        return route;
      }
    }
    
    return null;
  }
  
  /**
   * 更新攀爬进度
   */
  private updateProgress() {
    if (!this.state.activeRoute || !this.state.activeRoute.topHold) {
      this.state.progress = 0;
      return;
    }
    
    const route = this.state.activeRoute;
    const routeHoldIds = new Set(route.holds.map(h => h.id));
    
    // 计算触碰了多少当前线路的岩点
    let touched = 0;
    for (const id of this.state.touchedHolds) {
      if (routeHoldIds.has(id)) touched++;
    }
    
    this.state.progress = Math.round((touched / route.holds.length) * 100);
    
    // 检查是否触碰了 Top
    if (this.state.touchedHolds.has(route.topHold.id)) {
      this.state.progress = 100;
    }
  }
  
  /**
   * 获取当前状态
   */
  getState(): RouteAnalysisState {
    return this.state;
  }
  
  /**
   * 获取当前线路信息
   */
  getActiveRoute(): RouteGroup | null {
    return this.state.activeRoute;
  }
  
  /**
   * 获取实时提示
   */
  getHint(): string {
    if (!this.state.activeRoute) {
      return '等待检测线路... 请开始攀爬';
    }
    
    const route = this.state.activeRoute;
    
    if (this.state.progress === 100) {
      return `🎉 恭喜完成 ${route.colorName} 线路!`;
    }
    
    if (this.state.progress === 0) {
      return `准备攀爬 ${route.colorName} 线路`;
    }
    
    return `${route.colorName} 线路进度: ${this.state.progress}%`;
  }
  
  /**
   * 重置状态
   */
  reset() {
    this.state = {
      activeRoute: null,
      touchedHolds: new Set(),
      currentActions: new Map([
        ['leftHand', null],
        ['rightHand', null],
        ['leftFoot', null],
        ['rightFoot', null]
      ]),
      progress: 0
    };
  }
}

