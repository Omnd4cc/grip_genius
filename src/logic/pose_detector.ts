import * as poseDetection from '@tensorflow-models/pose-detection';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import { Keypoint } from '../types';

export class PoseDetector {
  detector: poseDetection.PoseDetector | null = null;

  async initialize() {
    await tf.ready();
    const model = poseDetection.SupportedModels.MoveNet;
    const detectorConfig = {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    };
    this.detector = await poseDetection.createDetector(model, detectorConfig);
    console.log('MoveNet model loaded.');
  }

  async estimatePoses(video: HTMLVideoElement): Promise<Keypoint[]> {
    if (!this.detector) return [];

    try {
      const poses = await this.detector.estimatePoses(video, {
        maxPoses: 1,
        flipHorizontal: false,
      });

      if (poses.length > 0) {
        // Convert to our Keypoint type
        return poses[0].keypoints.map(kp => ({
          x: kp.x,
          y: kp.y,
          score: kp.score,
          name: kp.name,
        }));
      }
    } catch (error) {
      console.error('Pose estimation error:', error);
    }
    return [];
  }
}

