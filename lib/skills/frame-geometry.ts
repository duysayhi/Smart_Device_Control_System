export interface DisplayRectangle { left: number; top: number; width: number; height: number }
/** object-fit:contain; browser coordinates never authorize a raw device tap. */
export function mapFramePointer(display: DisplayRectangle, image: { width: number; height: number }, point: { x: number; y: number }): { x: number; y: number } | undefined {
  if (![display.left, display.top, display.width, display.height, image.width, image.height, point.x, point.y].every(Number.isFinite) ||
    display.width <= 0 || display.height <= 0 || image.width <= 0 || image.height <= 0) return;
  const scale = Math.min(display.width / image.width, display.height / image.height);
  const left = display.left + (display.width - image.width * scale) / 2;
  const top = display.top + (display.height - image.height * scale) / 2;
  const x = (point.x - left) / (image.width * scale), y = (point.y - top) / (image.height * scale);
  if (x < 0 || x >= 1 || y < 0 || y >= 1) return;
  return { x, y };
}
export function uniqueControlAt<T extends { rectangle: [number, number, number, number] }>(controls: readonly T[], image: { width: number; height: number }, point: { x: number; y: number }): T | undefined {
  if (![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.x >= 1 || point.y < 0 || point.y >= 1 || image.width <= 0 || image.height <= 0) return;
  const x = point.x * image.width, y = point.y * image.height;
  const matches = controls.filter(c => x >= c.rectangle[0] && x < c.rectangle[2] && y >= c.rectangle[1] && y < c.rectangle[3]);
  return matches.length === 1 ? matches[0] : undefined;
}
