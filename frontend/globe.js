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

export function mountTravelGlobe(container, locations, onFocus, onSelect) {
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
      return;
    }

    const normal = pointOnGlobe(location.lat, location.lon, 1).normalize();
    const pin = new THREE.Group();
    pin.position.copy(normal.clone().multiplyScalar(RADIUS + 0.006));
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    globe.add(pin);

    const stem = new THREE.Mesh(
      new THREE.ConeGeometry(0.018, 0.085, 8),
      new THREE.MeshBasicMaterial({ color: 0xf3a86d })
    );
    stem.position.y = 0.038;
    pin.add(stem);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.027, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffd39b })
    );
    head.position.y = 0.083;
    const markerLocation = { ...location };
    head.userData.location = markerLocation;
    pin.add(head);

    const hitArea = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
    );
    hitArea.position.y = 0.065;
    hitArea.userData.location = markerLocation;
    pin.add(hitArea);
    markers.push(hitArea);
    markerByPlace.set(placeKey, hitArea);
  });

  if (routePoints.length > 1) {
    const routeVertices = [];
    for (let segment = 0; segment < routePoints.length - 1; segment += 1) {
      const start = routePoints[segment];
      const end = routePoints[segment + 1];
      const angle = start.angleTo(end);
      const sampleCount = Math.max(2, Math.ceil(angle * 36));
      for (let sample = 0; sample <= sampleCount; sample += 1) {
        const amount = sample / sampleCount;
        let point;
        if (angle < 0.0001) {
          point = start.clone();
        } else {
          point = start.clone().multiplyScalar(Math.sin((1 - amount) * angle) / Math.sin(angle))
            .add(end.clone().multiplyScalar(Math.sin(amount * angle) / Math.sin(angle)))
            .normalize();
        }
        routeVertices.push(point.multiplyScalar(RADIUS + 0.012));
      }
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(routeVertices),
      new THREE.LineBasicMaterial({ color: 0xffbd87, transparent: true, opacity: 0.88 })
    );
    globe.add(line);
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
  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  });
  resizeObserver.observe(container);

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
    renderer.render(scene, camera);
  }
  animate();

  return () => {
    disposed = true;
    window.cancelAnimationFrame(frame);
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
  };
}
