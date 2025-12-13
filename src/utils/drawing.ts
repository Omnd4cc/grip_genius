import { Keypoint, Hold } from '../types';
import { DetectedHold } from '../logic/hold_detector';

export function drawKeypoints(ctx: CanvasRenderingContext2D, keypoints: Keypoint[], scoreThreshold = 0.3) {
  ctx.fillStyle = 'red';
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;

  keypoints.forEach(kp => {
    if ((kp.score || 0) >= scoreThreshold) {
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  });
}

export function drawSkeleton(ctx: CanvasRenderingContext2D, keypoints: Keypoint[], scoreThreshold = 0.3) {
  const adjacentPairs = [
    ['nose', 'left_eye'], ['nose', 'right_eye'],
    ['left_eye', 'left_ear'], ['right_eye', 'right_ear'],
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'], ['right_knee', 'right_ankle']
  ];

  ctx.strokeStyle = '#00FF00';
  ctx.lineWidth = 2;

  const kpMap: { [key: string]: Keypoint } = {};
  keypoints.forEach(kp => {
    if (kp.name) kpMap[kp.name] = kp;
  });

  adjacentPairs.forEach(([p1, p2]) => {
    const kp1 = kpMap[p1];
    const kp2 = kpMap[p2];

    if (kp1 && kp2 && (kp1.score || 0) >= scoreThreshold && (kp2.score || 0) >= scoreThreshold) {
      ctx.beginPath();
      ctx.moveTo(kp1.x, kp1.y);
      ctx.lineTo(kp2.x, kp2.y);
      ctx.stroke();
    }
  });
}

const COLOR_HEX: Record<string, string> = {
  black: '#1a1a1a', blue: '#3b82f6', brown: '#a16207',
  cyan: '#06b6d4', gray: '#6b7280', green: '#22c55e',
  orange: '#f97316', pink: '#ec4899', purple: '#a855f7',
  red: '#ef4444', white: '#f5f5f5', yellow: '#eab308',
};

export function drawHolds(ctx: CanvasRenderingContext2D, holds: (Hold | DetectedHold)[]) {
  holds.forEach(hold => {
    // 判断是新类型还是旧类型
    const isDetectedHold = 'colorClass' in hold;
    
    if (isDetectedHold) {
      const dh = hold as DetectedHold;
      const color = COLOR_HEX[dh.color] || '#00FFFF';
      
      // 绘制多边形轮廓
      if (dh.points && dh.points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(dh.points[0].x, dh.points[0].y);
        for (const pt of dh.points.slice(1)) {
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();
        ctx.fillStyle = color + '40';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // 绘制圆形
        const radius = Math.max(dh.width, dh.height) / 2;
        ctx.beginPath();
        ctx.arc(dh.x, dh.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color + '40';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      // 绘制标签
      ctx.fillStyle = color;
      ctx.font = 'bold 12px Arial';
      ctx.fillText(dh.id, dh.x - 10, dh.y - (dh.height / 2) - 5);
    } else {
      // 旧类型 Hold
      const h = hold as Hold;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
      ctx.fill();
      ctx.strokeStyle = '#00FFFF';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.fillStyle = '#FFF';
      ctx.font = '12px Arial';
      ctx.fillText(h.id, h.x - 5, h.y - h.radius - 5);
    }
  });
}

