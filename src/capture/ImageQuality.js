export function analyzeImageQuality(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let gradientSum = 0;
  let darkPixels = 0;
  let brightPixels = 0;
  let sampleCount = 0;

  const step = Math.max(1, Math.floor(Math.min(width, height) / 180));
  const lumAt = (x, y) => {
    const index = (y * width + x) * 4;
    return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  };

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const luminance = lumAt(x, y);
      luminanceSum += luminance;
      luminanceSquaredSum += luminance * luminance;
      sampleCount += 1;

      if (luminance < 45) darkPixels += 1;
      if (luminance > 220) brightPixels += 1;

      if (x + step < width && y + step < height) {
        const gx = Math.abs(luminance - lumAt(x + step, y));
        const gy = Math.abs(luminance - lumAt(x, y + step));
        gradientSum += gx + gy;
      }
    }
  }

  const mean = luminanceSum / sampleCount;
  const variance = Math.max(0, luminanceSquaredSum / sampleCount - mean * mean);
  const stdDev = Math.sqrt(variance);
  const darkRatio = darkPixels / sampleCount;
  const brightRatio = brightPixels / sampleCount;
  const brightness = clamp01(mean / 255);
  const contrast = clamp01(stdDev / 74);
  const clarity = clamp01((gradientSum / sampleCount) / 38);
  const shadowRisk = darkRatio > 0.28 ? 'high' : darkRatio > 0.14 ? 'medium' : 'low';
  const glareRisk = brightRatio > 0.2 ? 'high' : brightRatio > 0.1 ? 'medium' : 'low';

  const warnings = [];
  if (brightness < 0.28) warnings.push('Lighting is low. Add more light before AR scanning.');
  if (contrast < 0.22) warnings.push('Page/background contrast is low. Use a clearer background if possible.');
  if (clarity < 0.18) warnings.push('Image looks soft or shaky. Hold the phone steady and retake.');
  if (shadowRisk === 'high') warnings.push('Strong shadows detected. Move hand/light source to reduce shadows.');
  if (glareRisk === 'high') warnings.push('Glare detected. Tilt the book/page or reduce reflections.');

  const score = clamp01((brightness * 0.28) + (contrast * 0.34) + (clarity * 0.3) + ((1 - darkRatio) * 0.08));
  const status = score >= 0.58 && warnings.length <= 2 ? 'usable' : score >= 0.38 ? 'limited' : 'poor';

  return {
    width,
    height,
    brightness: round(brightness),
    contrast: round(contrast),
    clarity: round(clarity),
    shadowRisk,
    glareRisk,
    score: round(score),
    status,
    warnings
  };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
