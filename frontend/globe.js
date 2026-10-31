import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const RADIUS = 2;

function makeEarthTexture(renderer) {
  const texture = new THREE.TextureLoader().load('./img/earth-blue-marble.jpg', loadedTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    canvas.getContext('2d').drawImage(loadedTexture.image, 0, 0, canvas.width, canvas.height);
    texture.image = canvas;
    texture.needsUpdate = true;
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function pointOnGlobe(latitude, longitude, radius) {
  const phi = THREE.MathUtils.degToRad(90 - latitude);
  const theta = THREE.MathUtils.degToRad(longitude + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function makeRouteArc(start, end, segment) {
  const angle = start.angleTo(end);
  if (angle < 0.001) return null;

  const sampleCount = Math.max(18, Math.ceil(angle * 42));
  const arcHeight = 0.16 + (segment % 2) * 0.1;
  const points = [];
  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const amount = sample / sampleCount;
    const direction = start.clone().multiplyScalar(Math.sin((1 - amount) * angle) / Math.sin(angle))
      .add(end.clone().multiplyScalar(Math.sin(amount * angle) / Math.sin(angle)))
      .normalize();
    const lift = 0.025 + Math.sin(Math.PI * amount) * arcHeight;
    points.push(direction.multiplyScalar(RADIUS + lift));
  }
  return { curve: new THREE.CatmullRomCurve3(points), points, sampleCount };
}

function localDateKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function makeVehicleTexture(type) {
  const icons = { plane: '✈️', ship: '⛴️', train: '🚆', bus: '🚌' };
  const colors = { plane: '#2563eb', ship: '#0e7490', train: '#7c3aed', bus: '#059669' };
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.beginPath();
  context.arc(64, 64, 58, 0, Math.PI * 2);
  context.fillStyle = '#0b1720';
  context.fill();
  context.lineWidth = 7;
  context.strokeStyle = colors[type] || '#38a9ff';
  context.stroke();
  context.font = '68px system-ui, Apple Color Emoji, Segoe UI Emoji, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(icons[type] || '🚆', 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeRouteBadgeTexture(label, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.beginPath();
  context.arc(64, 64, 55, 0, Math.PI * 2);
  context.fillStyle = '#12272d';
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = color;
  context.stroke();
  context.fillStyle = '#fff8ef';
  context.font = `bold ${label.length > 3 ? 32 : 42}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 64, 67, 102);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function mountTravelGlobe(container, locations, animatedTrips = [], celebrationDates = [], onFocus = () => {}, onSelect = () => {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.z = 8.7;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'Globo interactivo con destinos del viaje');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
  container.appendChild(renderer.domElement);
  const confettiCanvas = document.createElement('canvas');
  confettiCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  container.appendChild(confettiCanvas);
  const confettiContext = confettiCanvas.getContext('2d');
  let canvasWidth = 1;
  let canvasHeight = 1;

  scene.add(new THREE.AmbientLight(0xb8d2ce, 1.9));
  const sunlight = new THREE.DirectionalLight(0xffe1b0, 2.4);
  sunlight.position.set(-3, 4, 6);
  scene.add(sunlight);
  const fill = new THREE.DirectionalLight(0x55b9bd, 1.1);
  fill.position.set(4, -2, -4);
  scene.add(fill);

  const globe = new THREE.Group();
  globe.rotation.y = -Math.PI / 2;
  scene.add(globe);
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 72, 56),
    new THREE.MeshStandardMaterial({ map: makeEarthTexture(renderer), roughness: 0.92, metalness: 0 })
  );
  globe.add(earth);
  globe.add(new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 1.025, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x58c7c1, transparent: true, opacity: 0.055, side: THREE.BackSide })
  ));

  const markers = [];
  const markerByPlace = new Map();
  const routePoints = [];
  locations.forEach(location => {
    routePoints.push(pointOnGlobe(location.lat, location.lon, 1).normalize());
    const placeKey = `${location.lat.toFixed(3)}:${location.lon.toFixed(3)}`;
    const existingMarker = markerByPlace.get(placeKey);
    if (existingMarker) {
      const stages = new Set([existingMarker.userData.location.stage, location.stage].filter(Boolean));
      existingMarker.userData.location.stage = Array.from(stages).join(' y ');
      existingMarker.userData.location.routeNumbers.push(location.routeIndex + 1);
      const badge = existingMarker.userData.routeBadge;
      const previousTexture = badge.material.map;
      const badgeColor = existingMarker.userData.location.hasItinerary === true ? '#38a9ff' : '#36d990';
      badge.material.map = makeRouteBadgeTexture(
        existingMarker.userData.location.routeNumbers.join('·'),
        badgeColor
      );
      badge.material.needsUpdate = true;
      previousTexture?.dispose();
      return;
    }

    const normal = pointOnGlobe(location.lat, location.lon, 1).normalize();
    const markerColor = location.hasItinerary === true ? 0x38a9ff : 0x36d990;
    const markerColorHex = location.hasItinerary === true ? '#38a9ff' : '#36d990';
    const pin = new THREE.Group();
    pin.position.copy(normal.clone().multiplyScalar(RADIUS + 0.006));
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    globe.add(pin);

    const stem = new THREE.Mesh(
      new THREE.ConeGeometry(0.025, 0.1, 8),
      new THREE.MeshBasicMaterial({ color: markerColor })
    );
    stem.position.y = 0.045;
    pin.add(stem);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 14, 12),
      new THREE.MeshBasicMaterial({ color: markerColor })
    );
    head.position.y = 0.095;
    const markerLocation = { ...location, routeNumbers: [location.routeIndex + 1] };
    head.userData.location = markerLocation;
    pin.add(head);

    const badge = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeRouteBadgeTexture(String(location.routeIndex + 1), markerColorHex),
      transparent: true,
      depthTest: true
    }));
    badge.position.y = 0.22;
    badge.scale.set(0.22, 0.22, 1);
    pin.add(badge);

    const hitArea = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
    );
    hitArea.position.y = 0.065;
    hitArea.userData.location = markerLocation;
    hitArea.userData.routeBadge = badge;
    pin.add(hitArea);
    markers.push(hitArea);
    markerByPlace.set(placeKey, hitArea);
  });

  if (routePoints.length > 1) {
    for (let segment = 0; segment < routePoints.length - 1; segment += 1) {
      const start = routePoints[segment];
      const end = routePoints[segment + 1];
      const arcData = makeRouteArc(start, end, segment);
      if (!arcData) continue;
      const hasItinerary = locations[segment + 1].hasItinerary === true;
      const routeColor = hasItinerary ? 0x38a9ff : 0x36d990;
      globe.add(new THREE.Mesh(
        new THREE.TubeGeometry(arcData.curve, arcData.sampleCount, 0.022, 7, false),
        new THREE.MeshBasicMaterial({ color: routeColor, transparent: true, opacity: 0.96 })
      ));
      globe.add(new THREE.Mesh(
        new THREE.TubeGeometry(arcData.curve, arcData.sampleCount, 0.006, 6, false),
        new THREE.MeshBasicMaterial({ color: 0xe9f7ff, transparent: true, opacity: 0.78 })
      ));

      const arrowIndex = Math.floor(arcData.sampleCount * 0.68);
      const arrowDirection = arcData.points[arrowIndex + 1].clone().sub(arcData.points[arrowIndex - 1]).normalize();
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.042, 0.15, 9),
        new THREE.MeshBasicMaterial({ color: routeColor })
      );
      arrow.position.copy(arcData.points[arrowIndex]);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowDirection);
      globe.add(arrow);
    }
  }

  const starPositions = [];
  let seed = 20261010;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 500; i += 1) {
    const radius = 8 + random() * 15;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    starPositions.push(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
  }
  const starsGeometry = new THREE.BufferGeometry();
  starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  scene.add(new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0xa5c4c8, size: 0.025, transparent: true, opacity: 0.65 })));

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const activePointers = new Map();
  let activePointer = null;
  let lastPointer = null;
  let pinchDistance = 0;
  let dragged = false;
  let hovered = null;
  let frame = 0;
  let disposed = false;
  const resizeScene = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = width;
    canvasHeight = height;
    confettiCanvas.width = Math.round(width * pixelRatio);
    confettiCanvas.height = Math.round(height * pixelRatio);
    confettiContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const resizeObserver = new ResizeObserver(resizeScene);
  resizeObserver.observe(container);
  resizeScene();

  const stopIndexById = new Map(locations.map((location, index) => [location.id, index]));
  const validTrips = animatedTrips.flatMap(trip => {
    const fromIndex = stopIndexById.get(trip.from);
    const toIndex = stopIndexById.get(trip.to);
    if (!Number.isInteger(fromIndex) || toIndex !== fromIndex + 1) {
      console.error(`El trayecto animado ${trip.from} → ${trip.to} no conecta paradas consecutivas del globo.`);
      return [];
    }
    const arc = makeRouteArc(routePoints[fromIndex], routePoints[toIndex], fromIndex);
    return arc ? [{ trip, arc }] : [];
  });
  const confettiColors = ['#38bdf8', '#4ade80', '#facc15', '#fb7185', '#c084fc', '#fb923c'];
  let activeDate = '';
  let activeVehicles = [];
  let confettiEnabled = false;
  let confettiParticles = [];

  function updateDailyAnimations() {
    const today = localDateKey();
    if (today === activeDate) return;
    activeDate = today;

    activeVehicles.forEach(vehicle => {
      globe.remove(vehicle.sprite);
      vehicle.sprite.material.map?.dispose();
      vehicle.sprite.material.dispose();
    });
    activeVehicles = [];
    validTrips.filter(({ trip }) => trip.date === today).forEach(({ trip, arc }) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeVehicleTexture(trip.type),
        transparent: true,
        depthTest: true
      }));
      sprite.scale.set(0.34, 0.34, 1);
      sprite.renderOrder = 2;
      globe.add(sprite);
      activeVehicles.push({ sprite, curve: arc.curve, startedAt: performance.now(), duration: 7000 });
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
        color: confettiColors[Math.floor(Math.random() * confettiColors.length)]
      }))
      : [];
  }
  updateDailyAnimations();
  const dailyAnimationTimer = window.setInterval(updateDailyAnimations, 60_000);
  const onVisibilityChange = () => {
    if (!document.hidden) updateDailyAnimations();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  function hitMarker(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const firstHit = raycaster.intersectObjects([earth, ...markers], false)[0]?.object;
    return firstHit === earth ? null : firstHit || null;
  }
  function pointerDown(event) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragged = false;
    if (activePointers.size === 1) {
      activePointer = event.pointerId;
      lastPointer = { x: event.clientX, y: event.clientY };
    } else if (activePointers.size === 2) {
      const [first, second] = Array.from(activePointers.values());
      pinchDistance = Math.hypot(first.x - second.x, first.y - second.y);
      activePointer = null;
      lastPointer = null;
      dragged = true;
    }
    renderer.domElement.setPointerCapture(event.pointerId);
    if (activePointers.size === 1) renderer.domElement.style.cursor = 'grabbing';
  }
  function pointerMove(event) {
    if (activePointers.has(event.pointerId) && activePointers.size >= 2) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [first, second] = Array.from(activePointers.values());
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (pinchDistance) camera.position.z = THREE.MathUtils.clamp(camera.position.z - (distance - pinchDistance) * 0.012, 5.2, 10.5);
      pinchDistance = distance;
      dragged = true;
      return;
    }
    if (activePointer === event.pointerId && lastPointer) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const dx = event.clientX - lastPointer.x;
      const dy = event.clientY - lastPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
      globe.rotation.y += dx * 0.006;
      globe.rotation.x = THREE.MathUtils.clamp(globe.rotation.x + dy * 0.004, -0.55, 0.55);
      lastPointer = { x: event.clientX, y: event.clientY };
      return;
    }
    const marker = hitMarker(event);
    if (marker !== hovered) {
      hovered = marker;
      renderer.domElement.style.cursor = marker ? 'pointer' : 'grab';
      onFocus(marker?.userData.location || null);
    }
  }
  function pointerUp(event) {
    if (!activePointers.has(event.pointerId)) return;
    const wasTap = activePointer === event.pointerId && activePointers.size === 1 && !dragged;
    if (wasTap) {
      const marker = hitMarker(event);
      if (marker) onSelect(marker.userData.location);
    }
    activePointers.delete(event.pointerId);
    if (activePointers.size === 1) {
      const [[remainingId, position]] = activePointers.entries();
      activePointer = remainingId;
      lastPointer = position;
      pinchDistance = 0;
      dragged = true;
    } else if (activePointers.size === 0) {
      activePointer = null;
      lastPointer = null;
      pinchDistance = 0;
    }
    renderer.domElement.style.cursor = 'grab';
  }
  function wheel(event) {
    event.preventDefault();
    camera.position.z = THREE.MathUtils.clamp(camera.position.z + event.deltaY * 0.004, 5.2, 10.5);
  }
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointercancel', pointerUp);
  renderer.domElement.addEventListener('wheel', wheel, { passive: false });

  function animate() {
    if (disposed) return;
    frame = window.requestAnimationFrame(animate);
    const now = performance.now();
    activeVehicles.forEach(vehicle => {
      const progress = (now - vehicle.startedAt) % vehicle.duration / vehicle.duration;
      vehicle.sprite.position.copy(vehicle.curve.getPointAt(progress));
      const pulse = 0.34 + Math.sin(progress * Math.PI * 2) * 0.025;
      vehicle.sprite.scale.set(pulse, pulse, 1);
      vehicle.sprite.material.rotation = Math.sin(progress * Math.PI * 2) * 0.08;
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
    renderer.render(scene, camera);
  }
  animate();

  return () => {
    disposed = true;
    window.cancelAnimationFrame(frame);
    window.clearInterval(dailyAnimationTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    resizeObserver.disconnect();
    renderer.domElement.removeEventListener('pointerdown', pointerDown);
    renderer.domElement.removeEventListener('pointermove', pointerMove);
    renderer.domElement.removeEventListener('pointerup', pointerUp);
    renderer.domElement.removeEventListener('pointercancel', pointerUp);
    renderer.domElement.removeEventListener('wheel', wheel);
    scene.traverse(object => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose();
      object.material?.map?.dispose();
    });
    renderer.dispose();
    renderer.domElement.remove();
    confettiCanvas.remove();
  };
}
