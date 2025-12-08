import { BetaAction, DiffResult } from '../types';

export class DiffAnalyzer {
  compare(seqA: BetaAction[], seqB: BetaAction[]): DiffResult {
    const n = seqA.length;
    const m = seqB.length;
    
    // DP Table: dp[i][j] stores min cost to convert A[0..i-1] to B[0..j-1]
    const dp: number[][] = Array(n + 1).fill(0).map(() => Array(m + 1).fill(0));
    
    // Initialize base cases
    for (let i = 0; i <= n; i++) dp[i][0] = i; // Deletions from A
    for (let j = 0; j <= m; j++) dp[0][j] = j; // Insertions into A (to match B)

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = this.getCost(seqA[i - 1], seqB[j - 1]);
        
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,      // Deletion
          dp[i][j - 1] + 1,      // Insertion
          dp[i - 1][j - 1] + cost // Substitution / Match
        );
      }
    }

    // Backtrack to find operations
    const operations: DiffResult['operations'] = [];
    let i = n, j = m;
    
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0) {
        const cost = this.getCost(seqA[i - 1], seqB[j - 1]);
        if (dp[i][j] === dp[i - 1][j - 1] + cost) {
            if (cost === 0) {
                operations.unshift({ type: 'match', itemA: seqA[i-1], itemB: seqB[j-1], description: '动作一致' });
            } else {
                operations.unshift({ 
                    type: 'substitute', 
                    itemA: seqA[i-1], 
                    itemB: seqB[j-1], 
                    description: cost === 0.5 ? '支点选择不同' : '技术动作差异' 
                });
            }
            i--; j--;
            continue;
        }
      }
      
      if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
        operations.unshift({ type: 'delete', itemA: seqA[i-1], description: '多余动作 (A有B无)' });
        i--;
      } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
        operations.unshift({ type: 'insert', itemB: seqB[j-1], description: '缺失动作 (A无B有)' });
        j--;
      }
    }

    return {
      cost: dp[n][m],
      operations
    };
  }

  getCost(a: BetaAction, b: BetaAction): number {
    if (a.limb !== b.limb) return 1.0; // Different limb = totally different action usually
    
    const sameHold = a.holdId === b.holdId;
    const sameType = a.type === b.type;
    
    if (sameHold && sameType) return 0;
    if (!sameHold && sameType) return 0.5; // Same move, diff hold
    return 1.0;
  }
}

