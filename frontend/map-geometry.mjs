const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

export function greatCircleCoordinates(start, end) {
  const toVector = ({ lat, lon }) => {
    const latitude = lat * DEGREES_TO_RADIANS;
    const longitude = lon * DEGREES_TO_RADIANS;
    return [
      Math.cos(latitude) * Math.cos(longitude),
      Math.cos(latitude) * Math.sin(longitude),
      Math.sin(latitude)
    ];
  };
  const first = toVector(start);
  const second = toVector(end);
  const dotProduct = first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
  const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
  if (angle < 0.00001) return [[start.lat, start.lon], [end.lat, end.lon]];

  const steps = Math.max(12, Math.ceil(angle * 32));
  const denominator = Math.sin(angle);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    if (progress === 0) return [start.lat, start.lon];
    if (progress === 1) return [end.lat, end.lon];
    const firstWeight = Math.sin((1 - progress) * angle) / denominator;
    const secondWeight = Math.sin(progress * angle) / denominator;
    const x = first[0] * firstWeight + second[0] * secondWeight;
    const y = first[1] * firstWeight + second[1] * secondWeight;
    const z = first[2] * firstWeight + second[2] * secondWeight;
    return [
      Math.atan2(z, Math.hypot(x, y)) * RADIANS_TO_DEGREES,
      Math.atan2(y, x) * RADIANS_TO_DEGREES
    ];
  });
}
