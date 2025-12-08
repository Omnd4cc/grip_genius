import { Keypoint, ActionState, Hold, Limb, BetaAction } from '../types';
import { distance, angle } from '../utils/geometry';

export class ActionRecognizer {
  // Previous positions to calculate velocity
  prevPose: Keypoint[] | null = null;
  
  // State for each limb
  limbStates: Record<Limb, ActionState> = {
    leftHand: { limb: 'leftHand', state: 'Unknown', timestamp: 0 },
    rightHand: { limb: 'rightHand', state: 'Unknown', timestamp: 0 },
    leftFoot: { limb: 'leftFoot', state: 'Unknown', timestamp: 0 },
    rightFoot: { limb: 'rightFoot', state: 'Unknown', timestamp: 0 }
  };

  betaSequence: BetaAction[] = [];
  startTime: number = 0;

  constructor() {
    this.startTime = Date.now();
  }

  update(pose: Keypoint[], holds: Hold[], timestamp: number) {
    if (!this.prevPose) {
      this.prevPose = pose;
      return;
    }

    // Process each limb
    this.processLimb(pose, holds, 'leftHand', 'left_wrist', timestamp);
    this.processLimb(pose, holds, 'rightHand', 'right_wrist', timestamp);
    this.processLimb(pose, holds, 'leftFoot', 'left_ankle', timestamp);
    this.processLimb(pose, holds, 'rightFoot', 'right_ankle', timestamp);

    // Advanced Technics Detection
    this.detectAdvancedTechniques(pose, timestamp);

    this.prevPose = pose;
  }

  processLimb(pose: Keypoint[], holds: Hold[], limb: Limb, kpName: string, timestamp: number) {
    const kp = pose.find(p => p.name === kpName);
    const prevKp = this.prevPose?.find(p => p.name === kpName);

    if (!kp || !prevKp || (kp.score || 0) < 0.3) return;

    const vel = distance(kp, prevKp); 
    const state = this.limbStates[limb];
    
    // Thresholds
    const MOVE_THRES = 2.0; // px per frame, depends on resolution
    const HOLD_DIST_THRES = 30; // px radius to hold center

    // State Transitions
    // 1. Moving
    if (vel > MOVE_THRES) {
      if (state.state !== 'Moving') {
        state.state = 'Moving';
        state.holdId = undefined;
      }
    } 
    // 2. Potentially Holding (Low velocity)
    else {
      // Check proximity to any hold
      const nearestHold = this.findNearestHold(kp, holds);
      
      if (nearestHold && nearestHold.dist < HOLD_DIST_THRES) {
        if (state.state !== 'Holding' || state.holdId !== nearestHold.hold.id) {
            // Transition to Holding
            state.state = 'Holding';
            state.holdId = nearestHold.hold.id;
            
            // Record Action
            this.recordAction({
                id: `${timestamp}-${limb}`,
                timestamp: (timestamp - this.startTime) / 1000,
                type: limb.includes('Hand') ? 'Grab' : 'Step',
                limb: limb,
                holdId: nearestHold.hold.id,
                description: `${limb} ${limb.includes('Hand') ? 'grabs' : 'steps on'} ${nearestHold.hold.id}`
            });
        }
      } else {
         if (state.state === 'Moving') {
             state.state = 'Reaching';
         }
      }
    }
    
    state.timestamp = timestamp;
  }

  detectAdvancedTechniques(pose: Keypoint[], timestamp: number) {
      // Heel Hook: Angle(Hip, Knee, Ankle) < 120 && Ankle.y < Knee.y (approximately level or higher relative to knee usually, 
      // but user said Ankle.y < Knee.y + threshold. In screen coords, Y increases downwards. 
      // So Ankle (lower value) < Knee (higher value) means Ankle is HIGHER physically. 
      // Let's stick to user logic: Ankle.y < Knee.y + threshold
      
      // Left Leg
      this.checkHeelHook(pose, 'left', timestamp);
      // Right Leg
      this.checkHeelHook(pose, 'right', timestamp);

      // Crossover
      this.checkCrossover(pose, timestamp);
  }

  checkHeelHook(pose: Keypoint[], side: 'left' | 'right', timestamp: number) {
      const hip = pose.find(p => p.name === `${side}_hip`);
      const knee = pose.find(p => p.name === `${side}_knee`);
      const ankle = pose.find(p => p.name === `${side}_ankle`);
      const limbName: Limb = `${side}Foot`;

      if (hip && knee && ankle && this.limbStates[limbName].state === 'Holding') {
          const kneeAngle = angle(hip, knee, ankle);
          // Screen Y: smaller is higher. 
          // Ankle.y < Knee.y means Ankle is above Knee.
          // User: "Ankle.y < Knee.y + threshold" (meaning Ankle can be slightly below Knee too?)
          // Let's assume user means Ankle is relatively high.
          
          if (kneeAngle < 120 && ankle.y < (knee.y + 20)) {
              // Avoid spamming
              if (!this.lastActionIs(limbName, 'HeelHook')) {
                 const holdId = this.limbStates[limbName].holdId || '?';
                 this.recordAction({
                     id: `hh-${timestamp}-${side}`,
                     timestamp: (timestamp - this.startTime) / 1000,
                     type: 'HeelHook',
                     limb: limbName,
                     holdId: holdId,
                     description: `Heel Hook with ${side} leg on ${holdId}`
                 });
              }
          }
      }
  }

  checkCrossover(pose: Keypoint[], timestamp: number) {
      const nose = pose.find(p => p.name === 'nose');
      const rWrist = pose.find(p => p.name === 'right_wrist');
      
      if (nose && rWrist && this.limbStates['rightHand'].state === 'Holding') {
          // If right hand is to the LEFT of nose (x is smaller)
          if (rWrist.x < nose.x) {
               if (!this.lastActionIs('rightHand', 'Crossover')) {
                   const holdId = this.limbStates['rightHand'].holdId || '?';
                   this.recordAction({
                       id: `co-${timestamp}`,
                       timestamp: (timestamp - this.startTime) / 1000,
                       type: 'Crossover',
                       limb: 'rightHand',
                       holdId: holdId,
                       description: `Right hand Crossover on ${holdId}`
                   });
               }
          }
      }
  }

  findNearestHold(pt: Keypoint, holds: Hold[]) {
      let minDst = Infinity;
      let target: Hold | null = null;
      for (const h of holds) {
          const d = Math.sqrt(Math.pow(pt.x - h.x, 2) + Math.pow(pt.y - h.y, 2));
          if (d < minDst) {
              minDst = d;
              target = h;
          }
      }
      return target ? { hold: target, dist: minDst } : null;
  }

  recordAction(action: BetaAction) {
      // Debounce slightly or check for duplicates?
      // For now, just push.
      this.betaSequence.push(action);
      console.log('Action Recorded:', action.description);
  }

  lastActionIs(limb: Limb, type: string) {
      const last = this.betaSequence.filter(a => a.limb === limb).pop();
      return last && last.type === type;
  }
  
  getBetaSequence() {
      return this.betaSequence;
  }

  reset() {
      this.betaSequence = [];
      this.startTime = Date.now();
  }
}

