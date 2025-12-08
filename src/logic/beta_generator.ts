import { BetaSequence } from '../types';

export class BetaGenerator {
  generateText(sequence: BetaSequence): string[] {
    if (!sequence || sequence.actions.length === 0) {
      return ['等待分析动作...'];
    }

    const lines: string[] = [];
    
    // Sort by timestamp
    const sorted = [...sequence.actions].sort((a, b) => a.timestamp - b.timestamp);

    sorted.forEach((action, index) => {
        const timeStr = action.timestamp.toFixed(1) + 's';
        let text = '';
        
        switch (action.type) {
            case 'Start':
                text = `起步：双手/双脚位于 ${action.holdId}`;
                break;
            case 'Grab':
                text = `${this.limbName(action.limb)} 抓握 ${action.holdId}`;
                break;
            case 'Step':
                text = `${this.limbName(action.limb)} 踩踏 ${action.holdId}`;
                break;
            case 'HeelHook':
                text = `技巧：${this.limbName(action.limb)} 在 ${action.holdId} 使用挂脚 (Heel Hook)`;
                break;
            case 'Crossover':
                text = `技巧：${this.limbName(action.limb)} 交叉手 (Crossover) 去抓 ${action.holdId}`;
                break;
            case 'Match':
                text = `并手/并脚于 ${action.holdId}`;
                break;
            case 'Finish':
                text = `完成线路！`;
                break;
            default:
                text = action.description;
        }
        
        lines.push(`[${timeStr}] ${text}`);
    });

    return lines;
  }

  limbName(limb: string): string {
      const map: Record<string, string> = {
          'leftHand': '左手',
          'rightHand': '右手',
          'leftFoot': '左脚',
          'rightFoot': '右脚'
      };
      return map[limb] || limb;
  }
}

