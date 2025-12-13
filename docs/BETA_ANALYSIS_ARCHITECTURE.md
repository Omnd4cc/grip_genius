# Beta 智能分析系统 - 技术架构设计

## 1. 系统概述

本系统是一个基于**计算机视觉**和**机器学习**的攀岩动作分析工具。核心设计理念是：

> **让 AI 做感知，让规则做推理**

- AI 负责：检测岩点位置和颜色 (Roboflow API)、识别人体姿态 (MoveNet)
- 规则负责：确定线路、判断 Top/Start、追踪动作

---

## 2. 核心设计原则

### 2.1 领域知识的处理方式

| 领域知识 | 处理方式 | 原因 |
|---------|---------|------|
| "这是一个岩点" | AI 检测 (Roboflow) | 视觉模式识别，AI 擅长 |
| "这是什么颜色" | AI 分类 (16种颜色) | 模型已训练好颜色分类 |
| "同色岩点属于同一条线路" | 规则 (颜色分组) | 这是定义，不是模式 |
| "最高的点是 Top" | 规则 (Y坐标比较) | 简单数学，100%准确 |
| "人碰的点确定当前线路" | 规则 (姿态+距离) | 需要跨模型关联 |

### 2.2 模型能力 (Roboflow)

**16 种岩点颜色分类:**
```
black-hold, blue-hold, brown-hold, cyan-hold, gray-hold,
green-hold, orange-hold, pink-hold, purple-hold, red-hold,
white-hold, yellow-hold, black-pink-hold, black-white-hold,
black-yellow-hold, yellow-purple-hold
```

**输出数据:**
- 边界框 (x, y, width, height)
- 置信度 (confidence)
- 颜色类别 (class)
- 多边形轮廓 (points[])

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Phase 1: 预处理 (只执行一次)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   输入: 攀岩视频                                                             │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Step 1: 智能帧采样 (5帧)                                            │   │
│   │                                                                     │   │
│   │  ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐                   │   │
│   │  │开头  │   │ 1/3 │   │ 1/2 │   │ 2/3 │   │结尾  │                   │   │
│   │  │2.5s │   │     │   │     │   │     │   │-0.5s│                   │   │
│   │  └──┬──┘   └──┬──┘   └──┬──┘   └──┬──┘   └──┬──┘                   │   │
│   │     │         │         │         │         │                       │   │
│   │   start    middle    middle    middle     end                       │   │
│   │   (人少)   (攀爬中)  (攀爬中)  (攀爬中)   (可能到顶)                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Step 2: Roboflow API 岩点检测 (每帧)                                │   │
│   │  - 调用云端模型，返回岩点位置+颜色                                    │   │
│   │  - 过滤低置信度 (< 0.5) 的检测结果                                   │   │
│   │  - 输出: [{x, y, width, height, confidence, class, points}, ...]   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Step 2.5: K-Means 颜色矫正 (消除光照影响)                            │   │
│   │  - 提取每个岩点区域的 HSV 颜色特征                                    │   │
│   │  - 使用 K-Means 在 (H, S) 空间重新聚类                               │   │
│   │  - 矫正模型分类结果，消除光照/阴影导致的颜色误判                       │   │
│   │  - 输出: 更新 class 字段 + route_id + route_hsv_center              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Step 3: 多帧融合校准                                                │   │
│   │  - 位置接近 (< 40px) 且颜色相同 → 视为同一岩点                        │   │
│   │  - 保留置信度最高的检测结果                                          │   │
│   │  - 多帧都检测到的岩点优先保留                                        │   │
│   │  - 过滤只出现1帧且置信度 < 0.7 的噪点                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Step 4: 线路分组                                                    │   │
│   │  - 按颜色分组 (模型已提供颜色分类)                                    │   │
│   │  - 每条线路自动标记:                                                 │   │
│   │    - Top: Y 坐标最小的点 (画面最高)                                   │   │
│   │    - Start: Y 坐标最大的点 (画面最低)                                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Step 5: 当前线路检测 (基于中间3帧)                                   │   │
│   │  - 对中间3帧进行 MoveNet 姿态检测                                    │   │
│   │  - 获取手腕/脚踝位置                                                 │   │
│   │  - 找到接触的岩点 → 统计颜色投票                                      │   │
│   │  - 票数最多的颜色 = 当前线路                                         │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│   输出: {                                                                   │
│     allHolds: [...],           // 所有岩点 (含颜色、轮廓)                   │
│     routes: [                   // 线路分组                                │
│       { color: "yellow", holds: [...], topHold, startHold },             │
│       { color: "green", holds: [...], topHold, startHold }               │
│     ],                                                                     │
│     activeRoute: { color: "yellow", ... }  // 当前线路                     │
│   }                                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 缓存结果，传给 Phase 2
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Phase 2: 实时分析 (逐帧执行)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   视频逐帧播放                                                               │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  MoveNet 姿态检测                                                    │   │
│   │  - 实时追踪人体 17 个关键点                                           │   │
│   │  - 重点: 手腕 (wrist)、脚踝 (ankle)                                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  规则推理层                                                          │   │
│   │  1. 检测四肢触碰的岩点 (距离 < 阈值)                                  │   │
│   │  2. 追踪攀爬进度 (已触碰岩点 / 线路总岩点)                            │   │
│   │  3. 检测高阶动作 (Heel Hook, Crossover)                              │   │
│   │  4. 生成 Beta 文本描述                                               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│   输出: {                                                                   │
│     activeRoute: "yellow",     // 当前线路                                │
│     progress: 60,               // 攀爬进度 %                              │
│     betaSequence: [...]         // 动作序列                                │
│   }                                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. API 集成

### 4.1 Roboflow API

```typescript
// src/api/roboflow.ts
import { detectFromVideo, groupByColor, findRouteEndpoints } from './api/roboflow';

// 检测岩点
const predictions = await detectFromVideo(videoElement);

// 按颜色分组
const routes = groupByColor(predictions);
// Map { 'yellow' => [...], 'green' => [...] }

// 找 Top/Start
for (const [color, holds] of routes) {
  const { top, start } = findRouteEndpoints(holds);
}
```

### 4.2 颜色类别

| class_id | 类别名 | 显示名 |
|----------|--------|-------|
| 0 | black-hold | 黑色 |
| 3 | blue-hold | 蓝色 |
| 6 | gray-hold | 灰色 |
| 7 | green-hold | 绿色 |
| 8 | orange-hold | 橙色 |
| 10 | purple-hold | 紫色 |
| 11 | red-hold | 红色 |
| 13 | yellow-hold | 黄色 |
| ... | ... | ... |

---

## 5. 代码结构

```
src/
├── api/
│   └── roboflow.ts           # Roboflow API 封装
│       ├── detectByUrl()         # URL 图片检测
│       ├── detectByBase64()      # Base64 图片检测
│       ├── detectFromCanvas()    # Canvas 检测
│       ├── detectFromVideo()     # 视频帧检测
│       ├── groupByColor()        # 按颜色分组
│       ├── findRouteEndpoints()  # 找 Top/Start
│       └── drawPredictions()     # 绘制结果
│
├── logic/
│   ├── hold_detector.ts      # Phase 1: 岩点检测 Pipeline
│   │   ├── sampleFrames()        # 智能帧采样
│   │   ├── detectMultiFrame()    # 多帧检测
│   │   ├── mergeDetections()     # 融合校准
│   │   ├── groupHoldsToRoutes()  # 线路分组
│   │   ├── detectActiveRoute()   # 检测当前线路
│   │   └── detectHolds()         # 完整 Pipeline
│   │
│   ├── action_recognizer.ts  # Phase 2: 动作识别
│   ├── pose_detector.ts      # MoveNet 姿态检测
│   ├── beta_generator.ts     # Beta 文本生成
│   └── diff_analyzer.ts      # 序列对比分析
│
└── pages/
    └── BetaAnalysis/         # 分析页面
```

---

## 6. 关键算法

### 6.1 智能帧采样

```typescript
// 采样时间点
const samplePoints = [
  { time: 2.5,              type: 'start' },   // 开头：人刚起步
  { time: duration * 1/3,   type: 'middle' },  // 中间：攀爬中
  { time: duration * 1/2,   type: 'middle' },  // 中间：攀爬中
  { time: duration * 2/3,   type: 'middle' },  // 中间：攀爬中
  { time: duration - 0.5,   type: 'end' },     // 结尾：可能到顶
];
```

### 6.2 多帧融合

```typescript
function mergeDetections(frameResults, mergeThreshold = 40) {
  // 1. 遍历所有帧的检测结果
  // 2. 位置接近 (< 40px) 且颜色相同 → 合并
  // 3. 保留置信度最高的
  // 4. 过滤只出现1帧且置信度 < 0.7 的噪点
}
```

### 6.3 当前线路检测

```typescript
async function detectActiveRoute(middleFrames, holds, routes) {
  // 1. 对中间3帧进行姿态检测
  // 2. 获取手腕/脚踝位置
  // 3. 找接触的岩点 (距离 < 50px)
  // 4. 统计颜色投票
  // 5. 票数最多的颜色 = 当前线路
}
```

---

## 7. 使用示例

```typescript
import { detectHolds, drawDetectionResult } from './logic/hold_detector';
import { PoseDetector } from './logic/pose_detector';

// 初始化
const poseDetector = new PoseDetector();
await poseDetector.initialize();

// Phase 1: 检测岩点
const result = await detectHolds(videoElement, poseDetector, {
  minConfidence: 0.5,
  mergeThreshold: 40,
  detectActiveRoute: true
});

console.log(`检测到 ${result.allHolds.length} 个岩点`);
console.log(`识别 ${result.routes.length} 条线路`);
console.log(`当前线路: ${result.activeRoute?.color}`);

// 绘制结果
const ctx = canvas.getContext('2d');
drawDetectionResult(ctx, result, {
  highlightRoute: result.activeRoute?.color,
  showPolygon: true,
  showLabels: true
});
```

---

## 8. K-Means 颜色矫正算法

### 8.1 问题背景

由于光照、阴影等因素，Roboflow 模型对岩点颜色的分类可能不准确。例如：
- 阴影下的黄色岩点可能被识别为棕色
- 强光下的绿色岩点可能被识别为青色
- 同一颜色的岩点可能被分到不同类别

### 8.2 解决方案

使用 K-Means 聚类算法在 HSV 颜色空间对岩点进行重新分组：

```
┌─────────────────────────────────────────────────────────────────┐
│  输入: RoboflowPrediction[] + 原始图像                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  A1. 图像像素获取 (Canvas API)                                   │
│  - 将图像绘制到 Canvas                                           │
│  - 获取 ImageData                                                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  A2. 区域像素提取                                                │
│  - 使用 BBox 或 Polygon 裁剪每个岩点区域                          │
│  - 采样 ~500 像素/岩点 (性能优化)                                 │
│  - RGB → HSV 转换                                                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  A3. 特征计算                                                    │
│  - 过滤 V < 15 的暗像素 (阴影/背景)                               │
│  - 计算平均 H (使用向量平均处理循环性)                            │
│  - 计算平均 S                                                    │
│  - 输出: [H, S] 特征向量                                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  B1. 确定 K 值                                                   │
│  - 参考 Roboflow 分类的独立类数                                   │
│  - K = min(uniqueClasses, MAX_ROUTES=8, n/3)                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  B2. K-Means 聚类                                                │
│  - 初始化: K-Means++ (更稳定的初始质心)                           │
│  - 距离度量: HSV 距离 (考虑 H 的循环性)                           │
│  - 迭代收敛 (~50次)                                              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  C1-C3. 结果输出                                                 │
│  - 分配 route_id (0 到 K-1)                                      │
│  - 计算每个簇的 HSV 中心                                          │
│  - 根据 HSV 中心命名颜色 (red/yellow/green...)                   │
│  - 更新 prediction.class                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3 关键实现细节

**1. 色相循环平均**

色相 H 是循环值 (0°-360°)，不能直接算术平均。例如 350° 和 10° 的平均应该是 0°，而不是 180°。

```typescript
// 使用向量平均
let sinSum = 0, cosSum = 0;
for (const h of hues) {
  sinSum += Math.sin(h * Math.PI / 180);
  cosSum += Math.cos(h * Math.PI / 180);
}
const avgH = Math.atan2(sinSum / n, cosSum / n) * 180 / Math.PI;
```

**2. HSV 距离度量**

```typescript
function hsvDistance(a: [H, S], b: [H, S]): number {
  let hDiff = Math.abs(a[0] - b[0]);
  if (hDiff > 180) hDiff = 360 - hDiff;  // 循环处理
  const sDiff = Math.abs(a[1] - b[1]);
  return Math.sqrt(hDiff * hDiff + sDiff * sDiff * 0.5);
}
```

**3. 暗像素过滤**

V < 15 的像素被视为阴影或背景，不参与颜色计算。

### 8.4 使用方式

颜色矫正已集成到 `detectHolds` 函数中，默认启用：

```typescript
// 启用颜色矫正 (默认)
const result = await detectHolds(video, poseDetector, {
  enableColorCorrection: true
});

// 禁用颜色矫正
const result = await detectHolds(video, poseDetector, {
  enableColorCorrection: false
});
```

也可以单独使用：

```typescript
import { correctColors } from './logic/color_correction';

const corrected = await correctColors(predictions, canvasOrImage);
// corrected[i].route_id: 聚类结果
// corrected[i].route_hsv_center: 线路代表色
// corrected[i].corrected_color: 矫正后的颜色名
```

---

## 9. 后续优化方向

- [x] 集成 Roboflow API 进行岩点检测
- [x] 多帧融合提高检测准确率
- [x] 通过姿态检测自动确定当前线路
- [x] K-Means 颜色矫正 (消除光照影响)
- [ ] 优化 API 调用频率 (缓存/批量)
- [ ] 添加手动修正功能
- [ ] 支持离线模型 (ONNX)
- [ ] 多人场景支持

---

## 10. 参考资源

- [Roboflow API](https://docs.roboflow.com/)
- [MoveNet Model](https://www.tensorflow.org/hub/tutorials/movenet)
- [TensorFlow.js](https://www.tensorflow.org/js)
- [K-Means Clustering](https://en.wikipedia.org/wiki/K-means_clustering)
- [HSV Color Space](https://en.wikipedia.org/wiki/HSL_and_HSV)
