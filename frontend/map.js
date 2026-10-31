import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './travel-map.css';

const EUROPE_VIEW_BOUNDS = L.latLngBounds([35, -12], [70, 32]);
const EUROPE_PAN_BOUNDS = L.latLngBounds([31, -28], [74, 46]);
const ROUTE_COLORS = { official: '#38a9ff', stop: '#36d990' };
const CONFETTI_COLORS = ['#38bdf8', '#4ade80', '#facc15', '#fb7185', '#c084fc', '#fb923c'];
const VEHICLES = {
  plane: { icon: '✈️', label: 'Avión' },
  ship: { icon: '⛴️', label: 'Barco' },
  train: { icon: '🚆', label: 'Tren' },
  bus: { icon: '🚌', label: 'Bus' }
};
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

function localDateKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hasCoordinates(location) {
  return Number.isFinite(location.lat)
    && Number.isFinite(location.lon)
    && location.lat >= -90
    && location.lat <= 90
    && location.lon >= -180
    && location.lon <= 180;
}

function greatCircleCoordinates(start, end) {
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
  const angle = Math.acos(L.Util.clamp(
    first[0] * second[0] + first[1] * second[1] + first[2] * second[2],
    -1,
    1
  ));
  if (angle < 0.00001) return [[start.lat, start.lon], [end.lat, end.lon]];

  const steps = Math.max(12, Math.ceil(angle * 32));
  const denominator = Math.sin(angle);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
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

function makeVehicleIcon(type) {
  const vehicle = VEHICLES[type] || VEHICLES.train;
  return L.divIcon({
    className: 'travel-map-vehicle-icon',
    html: `<span role="img" aria-label="${vehicle.label}">${vehicle.icon}</span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });
}

export function mountTravelMap(container, locations, animatedTrips = [], celebrationDates = [], onFocus = () => {}, onSelect = () => {}) {
  const map = L.map(container, {
    attributionControl: true,
    maxBounds: EUROPE_PAN_BOUNDS,
    maxBoundsViscosity: 0.8,
    maxZoom: 12,
    minZoom: 3,
    preferCanvas: true,
    scrollWheelZoom: true,
    zoomControl: false,
    zoomSnap: 0.25
  });
  map.setView([53.5, 10], 4.5);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    maxZoom: 19,
    maxNativeZoom: 19
  }).addTo(map);

  const tileErrorNotice = document.createElement('p');
  tileErrorNotice.className = 'travel-map-tile-error';
  tileErrorNotice.hidden = true;
  tileErrorNotice.textContent = 'No se pudo cargar el mapa base. Revisá tu conexión.';
  container.appendChild(tileErrorNotice);
  let tileErrorReported = false;
  map.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
      layer.on('tileerror', () => {
        tileErrorNotice.hidden = false;
        if (!tileErrorReported) {
          tileErrorReported = true;
          console.error('No se pudieron cargar las teselas de OpenStreetMap.');
        }
      });
      layer.on('tileload', () => {
        tileErrorNotice.hidden = true;
      });
    }
  });

  const validLocations = locations.filter(location => {
    if (hasCoordinates(location)) return true;
    console.error(`No se puede ubicar la parada "${location.name || location.id}" porque sus coordenadas no son válidas.`);
    return false;
  });
  const locationsById = new Map(validLocations.map(location => [location.id, location]));
  map.fitBounds(EUROPE_VIEW_BOUNDS, { maxZoom: 5.25, padding: [48, 48] });

  for (let index = 0; index < validLocations.length - 1; index += 1) {
    const start = validLocations[index];
    const end = validLocations[index + 1];
    const coordinates = greatCircleCoordinates(start, end);
    L.polyline(coordinates, {
      className: 'travel-map-route-line',
      color: end.hasItinerary === true ? ROUTE_COLORS.official : ROUTE_COLORS.stop,
      interactive: false,
      opacity: 0.88,
      smoothFactor: 0.5,
      weight: 2.5
    }).addTo(map);
  }

  const markersByPlace = new Map();
  validLocations.forEach(location => {
    const placeKey = `${location.lat.toFixed(4)}:${location.lon.toFixed(4)}`;
    const existing = markersByPlace.get(placeKey);
    if (existing) {
      const stages = new Set([existing.location.stage, location.stage].filter(Boolean));
      existing.location.stage = Array.from(stages).join(' y ');
      if (!existing.location.hasItinerary && location.hasItinerary) {
        existing.location = { ...location, stage: existing.location.stage };
        existing.marker.options.title = location.name;
      }
      return;
    }

    const markerLocation = { ...location };
    const markerColor = markerLocation.hasItinerary === true ? 'official' : 'stop';
    const marker = L.marker([location.lat, location.lon], {
      alt: location.name || 'Parada del recorrido',
      icon: L.divIcon({
        className: `travel-map-city-icon travel-map-city-${markerColor}`,
        html: '<span aria-hidden="true"></span>',
        iconAnchor: [7, 7],
        iconSize: [14, 14]
      }),
      title: location.name || 'Parada del recorrido'
    }).addTo(map);
    const place = { location: markerLocation, marker };
    markersByPlace.set(placeKey, place);
    marker.on('mouseover', () => onFocus(place.location));
    marker.on('mouseout', () => onFocus(null));
    marker.on('click', () => {
      onFocus(place.location);
      onSelect(place.location);
    });
  });
  map.on('click', () => onFocus(null));

  const tripPaths = animatedTrips.flatMap(trip => {
    const from = locationsById.get(trip.from);
    const to = locationsById.get(trip.to);
    const fromIndex = validLocations.findIndex(location => location.id === trip.from);
    const toIndex = validLocations.findIndex(location => location.id === trip.to);
    if (!from || !to || toIndex !== fromIndex + 1) {
      console.error(`El trayecto animado ${trip.from} → ${trip.to} no conecta paradas consecutivas del mapa.`);
      return [];
    }
    return [{ trip, coordinates: greatCircleCoordinates(from, to) }];
  });

  const confettiCanvas = document.createElement('canvas');
  confettiCanvas.className = 'travel-map-confetti';
  container.appendChild(confettiCanvas);
  const confettiContext = confettiCanvas.getContext('2d');
  if (!confettiContext) throw new Error('No se pudo crear el lienzo para la animación del mapa.');
  let canvasWidth = 1;
  let canvasHeight = 1;
  let confettiEnabled = false;
  let confettiParticles = [];
  let activeDate = '';
  let activeVehicles = [];
  let frame = 0;
  let disposed = false;

  function resizeMap() {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = width;
    canvasHeight = height;
    confettiCanvas.width = Math.round(width * pixelRatio);
    confettiCanvas.height = Math.round(height * pixelRatio);
    confettiContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    map.invalidateSize({ pan: false });
  }
  const resizeObserver = new ResizeObserver(resizeMap);
  resizeObserver.observe(container);
  resizeMap();

  function updateDailyAnimations() {
    const today = localDateKey();
    if (today === activeDate) return;
    activeDate = today;
    activeVehicles.forEach(vehicle => map.removeLayer(vehicle.marker));
    activeVehicles = [];
    tripPaths.filter(({ trip }) => trip.date === today).forEach(({ trip, coordinates }) => {
      const marker = L.marker(coordinates[0], {
        icon: makeVehicleIcon(trip.type),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000
      }).addTo(map);
      activeVehicles.push({ marker, coordinates, startedAt: performance.now(), duration: 7000 });
    });

    confettiEnabled = celebrationDates.includes(today);
    confettiParticles = confettiEnabled
      ? Array.from({ length: 90 }, () => ({
        x: Math.random() * canvasWidth,
        y: Math.random() * canvasHeight,
        width: 4 + Math.random() * 5,
        height: 7 + Math.random() * 7,
        speed: 0.8 + Math.random() * 2.2,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.12,
        drift: Math.random() * Math.PI * 2,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
      }))
      : [];
  }

  updateDailyAnimations();
  const dailyAnimationTimer = window.setInterval(updateDailyAnimations, 60_000);
  const onVisibilityChange = () => {
    if (!document.hidden) updateDailyAnimations();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  function animate() {
    if (disposed) return;
    frame = window.requestAnimationFrame(animate);
    const now = performance.now();
    activeVehicles.forEach(vehicle => {
      const progress = ((now - vehicle.startedAt) % vehicle.duration) / vehicle.duration;
      const pathPosition = progress * (vehicle.coordinates.length - 1);
      const segment = Math.floor(pathPosition);
      const segmentProgress = pathPosition - segment;
      const start = vehicle.coordinates[segment];
      const end = vehicle.coordinates[Math.min(segment + 1, vehicle.coordinates.length - 1)];
      vehicle.marker.setLatLng([
        start[0] + (end[0] - start[0]) * segmentProgress,
        start[1] + (end[1] - start[1]) * segmentProgress
      ]);
    });

    confettiContext.clearRect(0, 0, canvasWidth, canvasHeight);
    if (confettiEnabled) {
      confettiParticles.forEach(particle => {
        particle.y += particle.speed;
        particle.x += Math.sin(now * 0.001 + particle.drift) * 0.45;
        particle.rotation += particle.spin;
        if (particle.y > canvasHeight + particle.height) {
          particle.y = -particle.height;
          particle.x = Math.random() * canvasWidth;
        }
        confettiContext.save();
        confettiContext.translate(particle.x, particle.y);
        confettiContext.rotate(particle.rotation);
        confettiContext.fillStyle = particle.color;
        confettiContext.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
        confettiContext.restore();
      });
    }
  }
  animate();

  return {
    focus(location) {
      if (!hasCoordinates(location) || !EUROPE_PAN_BOUNDS.contains([location.lat, location.lon])) return;
      map.flyTo([location.lat, location.lon], Math.max(map.getZoom(), 7), { duration: 0.65 });
    },
    dispose() {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.clearInterval(dailyAnimationTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      resizeObserver.disconnect();
      map.remove();
      confettiCanvas.remove();
      tileErrorNotice.remove();
    }
  };
}
