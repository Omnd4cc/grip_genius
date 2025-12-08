import { Keypoint, Hold } from '../types';

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

export function drawHolds(ctx: CanvasRenderingContext2D, holds: Hold[]) {
  holds.forEach(hold => {
    ctx.beginPath();
    ctx.arc(hold.x, hold.y, hold.radius, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.fill();
    ctx.strokeStyle = '#00FFFF';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw Label
    ctx.fillStyle = '#FFF';
    ctx.font = '12px Arial';
    ctx.fillText(hold.id, hold.x - 5, hold.y - hold.radius - 5);
  });
}

