// RGB to HSV conversion
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, v = max;

  const d = max - min;
  s = max === 0 ? 0 : d / max;

  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return [h * 360, s, v];
}

// Color distance as per formula
export function colorDistance(hsv1: [number, number, number], hsv2: [number, number, number]): number {
  // Hue is circular 0-360
  let dh = Math.abs(hsv1[0] - hsv2[0]);
  if (dh > 180) dh = 360 - dh;
  
  // Normalize to 0-1 for distance calc roughly or keep scale. 
  // Formula given: D = sqrt(0.5 * dH^2 + 0.3 * dS^2 + 0.2 * dV^2)
  // We need to decide on units. Usually H is most sensitive.
  // Let's normalize H to 0-1 range for this calculation if S and V are 0-1.
  // Assuming input H is 0-360, S 0-1, V 0-1.
  
  const normDh = dh / 180; // Normalize H difference
  const ds = hsv1[1] - hsv2[1];
  const dv = hsv1[2] - hsv2[2];

  return Math.sqrt(0.5 * Math.pow(normDh, 2) + 0.3 * Math.pow(ds, 2) + 0.2 * Math.pow(dv, 2));
}

// Simple Blob detection helper (conceptual, typically requires image traversal)
// This is a placeholder for the heavy lifting usually done on canvas pixel data
export function findBlobs(
  pixels: Uint8ClampedArray, 
  width: number, 
  height: number, 
  targetHsv: [number, number, number],
  threshold: number = 0.1
): { x: number, y: number, radius: number }[] {
  // Simplified Grid Search for performance in JS
  const blobs: { x: number, y: number, count: number }[] = [];
  const visited = new Uint8Array(width * height);
  const step = 4; // Skip pixels for speed

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      if (visited[y * width + x]) continue;

      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const hsv = rgbToHsv(r, g, b);
      
      if (colorDistance(hsv, targetHsv) < threshold) {
        // Found a matching pixel, do simple flood fill or region growing
        // For simplicity here, we just add to list and average later or simple clustering
        blobs.push({ x, y, count: 1 });
      }
    }
  }

  // Very naive clustering
  const merged: { x: number, y: number, radius: number, count: number }[] = [];
  
  blobs.forEach(b => {
    let found = false;
    for (let m of merged) {
      if (Math.abs(m.x - b.x) < 50 && Math.abs(m.y - b.y) < 50) { // 50px merge radius
        m.x = (m.x * m.count + b.x) / (m.count + 1);
        m.y = (m.y * m.count + b.y) / (m.count + 1);
        m.count++;
        found = true;
        break;
      }
    }
    if (!found) {
      merged.push({ x: b.x, y: b.y, radius: 10, count: 1 });
    }
  });

  return merged.filter(m => m.count > 5); // Filter noise
}

