export async function createBoundaryPreviewDataUrl(imageDataUrl, boundaryDetection, {
  maxDimension = 1000,
  jpegQuality = 0.9
} = {}) {
  const image = await loadImage(imageDataUrl);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);

  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  if (boundaryDetection?.detected && boundaryDetection.cornersPx) {
    drawDetectedBoundary(context, boundaryDetection.cornersPx, scale);
  } else {
    drawNotDetectedHint(context, canvas.width, canvas.height);
  }

  return canvas.toDataURL('image/jpeg', jpegQuality);
}

function drawDetectedBoundary(context, cornersPx, scale) {
  const points = [
    cornersPx.topLeft,
    cornersPx.topRight,
    cornersPx.bottomRight,
    cornersPx.bottomLeft
  ].map((point) => ({ x: point.x * scale, y: point.y * scale }));

  context.save();
  context.lineWidth = Math.max(3, Math.round(5 * scale));
  context.strokeStyle = '#22c55e';
  context.fillStyle = 'rgba(34, 197, 94, 0.16)';
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.fill();
  context.stroke();

  points.forEach((point, index) => {
    context.beginPath();
    context.fillStyle = '#facc15';
    context.arc(point.x, point.y, Math.max(6, 9 * scale), 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#020617';
    context.font = `${Math.max(10, 16 * scale)}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index + 1), point.x, point.y);
  });

  context.restore();
}

function drawNotDetectedHint(context, width, height) {
  context.save();
  context.strokeStyle = '#f97316';
  context.lineWidth = 4;
  context.setLineDash([12, 8]);
  context.strokeRect(width * 0.08, height * 0.08, width * 0.84, height * 0.84);
  context.fillStyle = 'rgba(2, 6, 23, 0.72)';
  context.fillRect(width * 0.08, height * 0.08, width * 0.84, 46);
  context.fillStyle = '#fed7aa';
  context.font = '18px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('Boundary not detected clearly — retake if needed', width / 2, height * 0.08 + 23);
  context.restore();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load captured image for boundary preview.'));
    image.src = src;
  });
}
