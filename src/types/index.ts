export interface Point {
  x: number;
  y: number;
}

export interface Keypoint extends Point {
  score?: number;
  name?: string;
}

export interface Hold {
  id: string; // G1, G2, etc.
  x: number;
  y: number;
  radius: number;
  color: [number, number, number]; // HSV or RGB
}

export type Limb = 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';

export interface ActionState {
  limb: Limb;
  state: 'Unknown' | 'Moving' | 'Reaching' | 'Holding';
  holdId?: string; // If holding
  timestamp: number;
}

export interface BetaAction {
  id: string;
  timestamp: number;
  type: 'Start' | 'Grab' | 'Step' | 'HeelHook' | 'Crossover' | 'Match' | 'Finish';
  limb: Limb;
  holdId: string;
  description: string;
}

export interface BetaSequence {
  actions: BetaAction[];
  totalTime: number;
  difficulty?: string;
}

export interface DiffResult {
  cost: number;
  operations: {
    type: 'match' | 'insert' | 'delete' | 'substitute';
    itemA?: BetaAction;
    itemB?: BetaAction;
    description: string;
  }[];
}

