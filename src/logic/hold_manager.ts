import { Hold, Keypoint } from '../types';
import { rgbToHsv, findBlobs } from '../utils/image_processing';

export class HoldManager {
  holds: Hold[] = [];
  targetColor: [number, number, number] | null = null; // HSV

  // Sample color around the wrists from the first frame/pose
  sampleHoldColor(
    ctx: CanvasRenderingContext2D,
    pose: Keypoint[]
  ): [number, number, number] | null {
    const leftWrist = pose.find(p => p.name === 'left_wrist');
    const rightWrist = pose.find(p => p.name === 'right_wrist');
    
    // Prefer right wrist, or use valid one
    const target = rightWrist || leftWrist;
    
    if (!target || (target.score || 0) < 0.3) return null;

    // Get image data around wrist
    const radius = 15;
    try {
        const imageData = ctx.getImageData(
            Math.max(0, target.x - radius), 
            Math.max(0, target.y - radius), 
            radius * 2, 
            radius * 2
        );
        
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
            r += imageData.data[i];
            g += imageData.data[i + 1];
            b += imageData.data[i + 2];
            count++;
        }
        
        if (count > 0) {
            this.targetColor = rgbToHsv(r / count, g / count, b / count);
            console.log('Sampled Target Color (HSV):', this.targetColor);
            return this.targetColor;
        }
    } catch (e) {
        console.error("Failed to sample color", e);
    }
    return null;
  }

  scanForHolds(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (!this.targetColor) return;

    const imageData = ctx.getImageData(0, 0, width, height);
    const blobs = findBlobs(imageData.data, width, height, this.targetColor);

    this.holds = blobs.map((b, i) => ({
      id: `G${i + 1}`,
      x: b.x,
      y: b.y,
      radius: b.radius,
      color: this.targetColor!
    }));
    
    console.log(`Detected ${this.holds.length} holds.`);
  }

  getHolds(): Hold[] {
    return this.holds;
  }
}

