/* ================================================================
   AETHER_STUDIO — Core Engine v0.1
   ================================================================
   Modules:
     1. ViewportEngine     — Three.js 3D scene, lighting, grid
     2. TelemetryEngine    — MediaPipe hands → 3D coordinate matrix
     3. GestureInterpreter — Gesture classification & event dispatch
     4. ConstraintLayer    — Snapping, tolerances, dimensional math
     5. SceneManager       — Object lifecycle, history
     6. ExportEngine       — STL / G-code compilation
     7. HUD                — Live readout & status
   ================================================================ */

'use strict';

// ──────────────────────────────────────────────────────────────────
// 0. GLOBAL STATE
// ──────────────────────────────────────────────────────────────────
const AETHER = {
  version:  '0.1.0',
  snapOn:   false,
  gridOn:   true,
  snapStep: 0.5,          // units (mm equivalent)
  tool:     'sculpt',
  hand: {
    raw:    null,         // raw MediaPipe landmarks (21 pts)
    coords: { x: 0, y: 0, z: 0 },   // mapped 3D coords
    prev:   { x: 0, y: 0, z: 0 },
    gesture: 'IDLE',
    pinchActive: false,
    pinchStart:  null,
    spreadActive: false,
    sweepActive:  false,
  },
  scene: {
    objects: [],
    selected: null,
    history: [],
  },
};


// ──────────────────────────────────────────────────────────────────
// 1. VIEWPORT ENGINE
// ──────────────────────────────────────────────────────────────────
const ViewportEngine = (() => {
  let renderer, scene, camera, controls, clock;
  let gridHelper, axesHelper, ambientLight, dirLight;
  let raycaster, mouse;

  const UNITS_PER_MM = 0.1;

  function init() {
    const canvas = document.getElementById('viewport');

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050508);
    scene.fog = new THREE.FogExp2(0x050508, 0.018);

    // Camera
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(8, 6, 10);

    // Orbit Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1;
    controls.maxDistance = 200;
    controls.target.set(0, 0, 0);

    // Lighting
    ambientLight = new THREE.AmbientLight(0x101828, 3.0);
    scene.add(ambientLight);

    dirLight = new THREE.DirectionalLight(0x00d4ff, 2.5);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x7b61ff, 1.2);
    rimLight.position.set(-8, 5, -8);
    scene.add(rimLight);

    // Grid
    buildGrid();

    // Axes helper (small, bottom corner)
    axesHelper = new THREE.AxesHelper(1.5);
    axesHelper.position.set(-9, 0.01, -9);
    scene.add(axesHelper);

    // Raycaster
    raycaster = new THREE.Raycaster();
    mouse     = new THREE.Vector2();

    // Clock
    clock = new THREE.Clock();

    // Resize
    window.addEventListener('resize', onResize);

    // Start loop
    animate();

    console.log('[AETHER] ViewportEngine initialised');
  }

  function buildGrid() {
    if (gridHelper) scene.remove(gridHelper);
    if (!AETHER.gridOn) return;

    // Primary grid
    gridHelper = new THREE.GridHelper(40, 80, 0x001828, 0x001020);
    gridHelper.material.opacity = 0.6;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // Accent grid lines (every 10 units)
    const accentGrid = new THREE.GridHelper(40, 8, 0x004466, 0x002233);
    accentGrid.material.opacity = 0.35;
    accentGrid.material.transparent = true;
    accentGrid.position.y = 0.001;
    scene.add(accentGrid);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    controls.update();
    TelemetryEngine.update();
    GestureInterpreter.update();
    renderer.render(scene, camera);
  }

  // Drop a point marker in 3D space
  function placePoint(x, y, z, color = 0x00d4ff) {
    const geo  = new THREE.SphereGeometry(0.04, 8, 8);
    const mat  = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.8,
      roughness: 0.2, metalness: 0.5,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    AETHER.scene.objects.push({ type: 'point', mesh });
    return mesh;
  }

  // Extrude a profile along Y axis from current hand position
  function extrudeProfile(profilePoints, height = 2) {
    if (profilePoints.length < 3) return;
    const shape = new THREE.Shape();
    shape.moveTo(profilePoints[0].x, profilePoints[0].z);
    for (let i = 1; i < profilePoints.length; i++) {
      shape.lineTo(profilePoints[i].x, profilePoints[i].z);
    }
    shape.closePath();

    const extrudeSettings = { depth: height, bevelEnabled: false };
    const geo  = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const mat  = new THREE.MeshStandardMaterial({
      color: 0x7b61ff, emissive: 0x2a0066,
      roughness: 0.3, metalness: 0.7,
      transparent: true, opacity: 0.85,
      wireframe: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    AETHER.scene.objects.push({ type: 'extrusion', mesh, profilePoints, height });
    return mesh;
  }

  // Approximate a cylinder from hand spread radius
  function placeCylinder(cx, cy, cz, radius, height) {
    radius = ConstraintLayer.snapValue(radius);
    height = ConstraintLayer.snapValue(height);
    const geo  = new THREE.CylinderGeometry(radius, radius, height, 32);
    const mat  = new THREE.MeshStandardMaterial({
      color: 0x00d4ff, emissive: 0x003344,
      roughness: 0.25, metalness: 0.8,
      transparent: true, opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy + height / 2, cz);
    mesh.castShadow = true;
    scene.add(mesh);
    AETHER.scene.objects.push({ type: 'cylinder', mesh, radius, height });
    notify(`CYLINDER r=${radius.toFixed(2)} h=${height.toFixed(2)}`);
    return mesh;
  }

  function clearScene() {
    for (const obj of AETHER.scene.objects) {
      scene.remove(obj.mesh);
      obj.mesh.geometry.dispose();
    }
    AETHER.scene.objects = [];
    AETHER.scene.selected = null;
    notify('SCENE CLEARED');
  }

  function toggleGrid() {
    AETHER.gridOn = !AETHER.gridOn;
    buildGrid();
  }

  function getScene() { return scene; }
  function getCamera() { return camera; }
  function getRenderer() { return renderer; }

  return { init, placePoint, extrudeProfile, placeCylinder, clearScene, toggleGrid, getScene, getCamera };
})();


// ──────────────────────────────────────────────────────────────────
// 2. TELEMETRY ENGINE (Webcam → 3D Coordinate Matrix)
// ──────────────────────────────────────────────────────────────────
const TelemetryEngine = (() => {
  let hands, camera, trackingCtx;
  let isReady = false;
  let frameBuffer = [];
  const SMOOTH_FRAMES = 5;

  // Viewport depth estimation parameters
  const DEPTH_SCALE  = 6;     // Z sensitivity
  const SPACE_SCALE  = 10;    // XY mapping scale to 3D units

  function init() {
    const video   = document.getElementById('webcam');
    const canvas  = document.getElementById('tracking-canvas');
    trackingCtx   = canvas.getContext('2d');

    // MediaPipe Hands
    hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6,
    });

    hands.onResults(onResults);

    // Camera utility
    camera = new Camera(video, {
      onFrame: async () => { await hands.send({ image: video }); },
      width: 640, height: 480,
    });

    camera.start().then(() => {
      isReady = true;
      HUD.setTrackingStatus('online');
      notify('OPTICAL TELEMETRY ONLINE');
    }).catch((err) => {
      console.warn('[AETHER] Camera access denied:', err);
      HUD.setTrackingStatus('offline');
      notify('CAMERA ACCESS DENIED — KEYBOARD MODE');
    });
  }

  function onResults(results) {
    const canvas = document.getElementById('tracking-canvas');
    trackingCtx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      AETHER.hand.raw = null;
      GestureInterpreter.onNoHand();
      return;
    }

    const landmarks = results.multiHandLandmarks[0];
    AETHER.hand.raw = landmarks;
    HUD.setTrackingStatus('tracking');

    // Draw skeleton overlay
    drawConnectors(trackingCtx, landmarks, HAND_CONNECTIONS, {
      color: 'rgba(0, 212, 255, 0.6)', lineWidth: 1.5,
    });
    drawLandmarks(trackingCtx, landmarks, {
      color: 'rgba(123, 97, 255, 0.9)', lineWidth: 1, radius: 3,
    });

    // ── Map to 3D coordinate matrix ──
    // Wrist = landmark 0, Middle finger base = landmark 9
    // We use the wrist as origin anchor
    const wrist  = landmarks[0];
    const mid    = landmarks[9];
    const index  = landmarks[8];   // index tip
    const thumb  = landmarks[4];   // thumb tip

    // Raw 2D screen coords (0..1, mirrored)
    const rawX =  (0.5 - wrist.x) * SPACE_SCALE;
    const rawY = -(wrist.y - 0.5) * SPACE_SCALE;
    // Z from hand "depth" — MediaPipe gives a relative z per landmark
    // We use wrist z (negative = closer to camera)
    const rawZ = -wrist.z * DEPTH_SCALE;

    // Smooth with ring buffer
    frameBuffer.push({ x: rawX, y: rawY, z: rawZ });
    if (frameBuffer.length > SMOOTH_FRAMES) frameBuffer.shift();

    const smoothed = frameBuffer.reduce(
      (acc, f) => ({ x: acc.x + f.x / SMOOTH_FRAMES, y: acc.y + f.y / SMOOTH_FRAMES, z: acc.z + f.z / SMOOTH_FRAMES }),
      { x: 0, y: 0, z: 0 }
    );

    AETHER.hand.prev   = { ...AETHER.hand.coords };
    AETHER.hand.coords = AETHER.snapOn
      ? ConstraintLayer.snap3D(smoothed)
      : smoothed;

    // Pass full landmarks to gesture interpreter
    GestureInterpreter.onLandmarks(landmarks);
  }

  function update() {
    // Called every animation frame — telemetry is event-driven, nothing needed here
  }

  return { init, update };
})();


// ──────────────────────────────────────────────────────────────────
// 3. GESTURE INTERPRETER
// ──────────────────────────────────────────────────────────────────
const GestureInterpreter = (() => {
  // State machine
  const State = {
    IDLE: 'IDLE',
    PINCH: 'PINCH',
    SPREAD: 'SPREAD',
    SWEEP: 'SWEEP',
    POINT: 'POINT',
    FIST: 'FIST',
  };

  let currentState = State.IDLE;
  let pinchStartCoords = null;
  let pinchStartDist   = null;
  let sweepBuffer      = [];
  const SWEEP_BUFFER   = 15;
  let lastPlacedTime   = 0;
  let profilePoints    = [];
  let isRecordingProfile = false;

  // Euclidean distance between two landmarks
  function dist(a, b) {
    return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
  }

  function classifyGesture(lm) {
    const pinchDist  = dist(lm[4], lm[8]);   // thumb tip ↔ index tip
    const spreadDist = dist(lm[4], lm[20]);  // thumb ↔ pinky tip
    const fistDist   = dist(lm[0], lm[9]);   // wrist ↔ middle base (open vs fist)

    // Pinch: thumb and index very close
    if (pinchDist < 0.05)  return State.PINCH;
    // Spread: all fingers extended wide
    if (spreadDist > 0.35) return State.SPREAD;
    // Fist: fingers curled
    if (fistDist < 0.10)   return State.FIST;
    // Point: index extended, others curled
    const indexExtended = dist(lm[8], lm[5]) > 0.12;
    const middleCurled  = dist(lm[12], lm[9]) < 0.09;
    if (indexExtended && middleCurled) return State.POINT;

    return State.IDLE;
  }

  function onLandmarks(lm) {
    const newState = classifyGesture(lm);
    const coords   = AETHER.hand.coords;

    HUD.updateCoords(coords);
    HUD.setGesture(newState);

    // Gesture ring position
    const ring = document.getElementById('gesture-ring');
    ring.classList.remove('hidden');
    // Map 3D coords back to screen (rough approximation)
    const sx = ((1 - (lm[8].x)) * window.innerWidth);
    const sy = lm[8].y * window.innerHeight;
    ring.style.left = sx + 'px';
    ring.style.top  = sy + 'px';

    // ── State machine transitions ──
    if (newState === State.PINCH && currentState !== State.PINCH) {
      onPinchStart(coords, lm);
    } else if (newState !== State.PINCH && currentState === State.PINCH) {
      onPinchEnd(coords);
    }

    if (newState === State.SPREAD) {
      onSpread(lm);
    }

    if (newState === State.POINT && AETHER.tool === 'sculpt') {
      onPoint(coords);
    }

    // Sweep detection (significant horizontal velocity)
    sweepBuffer.push(coords.x);
    if (sweepBuffer.length > SWEEP_BUFFER) sweepBuffer.shift();
    if (sweepBuffer.length === SWEEP_BUFFER) {
      const vel = Math.abs(sweepBuffer[sweepBuffer.length-1] - sweepBuffer[0]);
      if (vel > 1.8 && currentState !== State.SWEEP) {
        onSweep(coords);
      }
    }

    currentState = newState;
  }

  function onPinchStart(coords, lm) {
    currentState    = State.PINCH;
    pinchStartCoords = { ...coords };
    pinchStartDist  = dist(lm[4], lm[8]);
    AETHER.hand.pinchActive = true;
    notify('PINCH — GRAB');

    // Start profile recording if in sculpt mode
    if (AETHER.tool === 'sculpt') {
      isRecordingProfile = true;
      profilePoints = [{ ...coords }];
    }
  }

  function onPinchEnd(coords) {
    AETHER.hand.pinchActive = false;
    if (isRecordingProfile && profilePoints.length >= 3) {
      ViewportEngine.extrudeProfile(profilePoints, 1.5);
      notify(`PROFILE EXTRUDED — ${profilePoints.length} PTS`);
    }
    isRecordingProfile = false;
    profilePoints = [];
    pinchStartCoords = null;
  }

  function onSpread(lm) {
    // Spread = scale / cylinder creation
    const spreadDist = dist(lm[4], lm[20]);
    const radius = spreadDist * 8; // map to 3D units
    const now = Date.now();
    if (now - lastPlacedTime > 1200) {
      const c = AETHER.hand.coords;
      ViewportEngine.placeCylinder(c.x, Math.max(c.y, 0), c.z, radius, radius * 2);
      lastPlacedTime = now;
    }
  }

  function onPoint(coords) {
    const now = Date.now();
    if (isRecordingProfile) {
      profilePoints.push({ ...coords });
    } else if (now - lastPlacedTime > 500) {
      ViewportEngine.placePoint(coords.x, Math.max(coords.y, 0), coords.z);
      lastPlacedTime = now;
    }
  }

  function onSweep(coords) {
    if (AETHER.tool === 'extrude' && AETHER.scene.selected) {
      // Extrude selected object in sweep direction
      notify('SWEEP — EXTRUDE');
    } else {
      notify('SWEEP DETECTED');
    }
  }

  function onNoHand() {
    document.getElementById('gesture-ring').classList.add('hidden');
    HUD.setGesture('IDLE');
    HUD.setTrackingStatus('online');
    currentState = State.IDLE;
  }

  function update() {
    // Profile point recording
    if (isRecordingProfile && AETHER.hand.raw) {
      const coords = AETHER.hand.coords;
      const last   = profilePoints[profilePoints.length - 1];
      if (!last) return;
      const moved = Math.sqrt((coords.x-last.x)**2+(coords.z-last.z)**2);
      if (moved > 0.15) profilePoints.push({ ...coords });
    }
  }

  return { onLandmarks, onNoHand, update };
})();


// ──────────────────────────────────────────────────────────────────
// 4. CONSTRAINT LAYER (Precision & Snapping)
// ──────────────────────────────────────────────────────────────────
const ConstraintLayer = (() => {
  function snapValue(val) {
    if (!AETHER.snapOn) return val;
    return Math.round(val / AETHER.snapStep) * AETHER.snapStep;
  }

  function snap3D(coords) {
    return {
      x: snapValue(coords.x),
      y: snapValue(coords.y),
      z: snapValue(coords.z),
    };
  }

  // Check if two values are within tolerance
  function withinTolerance(a, b, tol = 0.01) {
    return Math.abs(a - b) <= tol;
  }

  // Nearest parallel axis (for orthogonal constraints)
  function snapToAxis(delta) {
    const ax = Math.abs(delta.x);
    const ay = Math.abs(delta.y);
    const az = Math.abs(delta.z);
    if (ax > ay && ax > az) return { x: delta.x, y: 0, z: 0 };
    if (ay > ax && ay > az) return { x: 0, y: delta.y, z: 0 };
    return { x: 0, y: 0, z: delta.z };
  }

  // Convert 3D units → mm (display)
  function toMM(units) {
    return (units * 10).toFixed(2) + 'mm';
  }

  // Distance between two 3D points in mm
  function distanceMM(a, b) {
    const d = Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2);
    return toMM(d);
  }

  // Angle between two vectors (degrees)
  function angleDeg(v1, v2) {
    const dot  = v1.x*v2.x + v1.y*v2.y + v1.z*v2.z;
    const mag1 = Math.sqrt(v1.x**2 + v1.y**2 + v1.z**2);
    const mag2 = Math.sqrt(v2.x**2 + v2.y**2 + v2.z**2);
    if (mag1 === 0 || mag2 === 0) return 0;
    return (Math.acos(Math.min(Math.max(dot / (mag1 * mag2), -1), 1)) * 180 / Math.PI).toFixed(1);
  }

  return { snapValue, snap3D, withinTolerance, snapToAxis, toMM, distanceMM, angleDeg };
})();


// ──────────────────────────────────────────────────────────────────
// 5. EXPORT ENGINE (STL / G-code)
// ──────────────────────────────────────────────────────────────────
const ExportEngine = (() => {
  function exportSTL() {
    const scene  = ViewportEngine.getScene();
    const meshes = AETHER.scene.objects.map(o => o.mesh).filter(Boolean);

    if (meshes.length === 0) {
      notify('NO GEOMETRY TO EXPORT');
      return;
    }

    let stl = 'solid aether_export\n';
    for (const mesh of meshes) {
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);

      // Ensure non-indexed
      const indexedGeo = geo.index ? geo.toNonIndexed() : geo;
      const pos = indexedGeo.attributes.position;

      for (let i = 0; i < pos.count; i += 3) {
        const v0 = new THREE.Vector3(pos.getX(i),   pos.getY(i),   pos.getZ(i));
        const v1 = new THREE.Vector3(pos.getX(i+1), pos.getY(i+1), pos.getZ(i+1));
        const v2 = new THREE.Vector3(pos.getX(i+2), pos.getY(i+2), pos.getZ(i+2));

        const edge1 = new THREE.Vector3().subVectors(v1, v0);
        const edge2 = new THREE.Vector3().subVectors(v2, v0);
        const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

        stl += `  facet normal ${n(normal.x)} ${n(normal.y)} ${n(normal.z)}\n`;
        stl += `    outer loop\n`;
        stl += `      vertex ${n(v0.x)} ${n(v0.y)} ${n(v0.z)}\n`;
        stl += `      vertex ${n(v1.x)} ${n(v1.y)} ${n(v1.z)}\n`;
        stl += `      vertex ${n(v2.x)} ${n(v2.y)} ${n(v2.z)}\n`;
        stl += `    endloop\n`;
        stl += `  endfacet\n`;
      }
    }
    stl += 'endsolid aether_export\n';

    download('aether_export.stl', stl);
    notify(`EXPORTED STL — ${meshes.length} OBJECT(S)`);
  }

  function n(v) { return v.toFixed(6); }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { exportSTL };
})();


// ──────────────────────────────────────────────────────────────────
// 6. HUD (Live Readout)
// ──────────────────────────────────────────────────────────────────
const HUD = (() => {
  const elX     = document.getElementById('coord-x');
  const elY     = document.getElementById('coord-y');
  const elZ     = document.getElementById('coord-z');
  const elGest  = document.getElementById('gesture-label');
  const elSnap  = document.getElementById('snap-label');
  const elStatus = document.getElementById('status-tracking');
  const elStatusLbl = document.getElementById('status-label');

  function updateCoords(c) {
    elX.textContent = (c.x * 10).toFixed(1) + 'mm';
    elY.textContent = (c.y * 10).toFixed(1) + 'mm';
    elZ.textContent = (c.z * 10).toFixed(1) + 'mm';
  }

  function setGesture(g) {
    AETHER.hand.gesture = g;
    elGest.textContent = 'GESTURE: ' + g;
  }

  function setSnapStatus(on) {
    elSnap.textContent = 'SNAP: ' + (on ? 'ON' : 'OFF');
    elSnap.className   = on ? 'on' : '';
  }

  function setTrackingStatus(status) {
    elStatus.className = 'status-dot ' + status;
    elStatusLbl.textContent =
      status === 'tracking' ? 'HAND DETECTED' :
      status === 'online'   ? 'TRACKING READY' :
                              'TRACKING OFFLINE';
  }

  return { updateCoords, setGesture, setSnapStatus, setTrackingStatus };
})();


// ──────────────────────────────────────────────────────────────────
// 7. NOTIFICATION SYSTEM
// ──────────────────────────────────────────────────────────────────
let notifyTimeout;
function notify(msg) {
  const el = document.getElementById('notification');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(notifyTimeout);
  notifyTimeout = setTimeout(() => el.classList.remove('show'), 2200);
}


// ──────────────────────────────────────────────────────────────────
// 8. CONTROL BINDINGS
// ──────────────────────────────────────────────────────────────────
function bindControls() {
  // Toolbar
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AETHER.tool = btn.dataset.tool;
      if (AETHER.tool === 'clear') {
        ViewportEngine.clearScene();
        AETHER.tool = 'sculpt';
        document.querySelector('[data-tool="sculpt"]').classList.add('active');
        btn.classList.remove('active');
      } else {
        notify('TOOL: ' + AETHER.tool.toUpperCase());
      }
    });
  });

  // Snap toggle
  const btnSnap = document.getElementById('btn-snap');
  btnSnap.addEventListener('click', () => {
    AETHER.snapOn = !AETHER.snapOn;
    btnSnap.textContent = AETHER.snapOn ? 'SNAP ON' : 'SNAP OFF';
    btnSnap.classList.toggle('snap-active', AETHER.snapOn);
    HUD.setSnapStatus(AETHER.snapOn);
    notify('SNAP ' + (AETHER.snapOn ? 'ENABLED' : 'DISABLED'));
  });

  // Grid toggle
  const btnGrid = document.getElementById('btn-grid');
  btnGrid.addEventListener('click', () => {
    AETHER.gridOn = !AETHER.gridOn;
    ViewportEngine.toggleGrid();
    btnGrid.textContent = AETHER.gridOn ? 'GRID ON' : 'GRID OFF';
    btnGrid.classList.toggle('active', AETHER.gridOn);
  });

  // Camera
  document.getElementById('btn-camera').addEventListener('click', () => {
    TelemetryEngine.init();
    notify('REQUESTING CAMERA ACCESS...');
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', () => {
    ExportEngine.exportSTL();
  });

  // Keyboard fallback (for non-gesture / testing)
  window.addEventListener('keydown', (e) => {
    const step = AETHER.snapOn ? AETHER.snapStep : 0.2;
    const c    = AETHER.hand.coords;
    switch(e.key) {
      case 'ArrowLeft':  AETHER.hand.coords.x -= step; break;
      case 'ArrowRight': AETHER.hand.coords.x += step; break;
      case 'ArrowUp':    e.shiftKey ? (AETHER.hand.coords.y += step) : (AETHER.hand.coords.z -= step); break;
      case 'ArrowDown':  e.shiftKey ? (AETHER.hand.coords.y -= step) : (AETHER.hand.coords.z += step); break;
      case ' ':
        // Space = place point
        ViewportEngine.placePoint(c.x, Math.max(c.y, 0), c.z);
        notify(`POINT PLACED  ${ConstraintLayer.toMM(c.x)} ${ConstraintLayer.toMM(c.y)} ${ConstraintLayer.toMM(c.z)}`);
        break;
      case 's': case 'S':
        AETHER.snapOn = !AETHER.snapOn;
        HUD.setSnapStatus(AETHER.snapOn);
        document.getElementById('btn-snap').textContent = AETHER.snapOn ? 'SNAP ON' : 'SNAP OFF';
        document.getElementById('btn-snap').classList.toggle('snap-active', AETHER.snapOn);
        break;
      case 'e': case 'E':
        ExportEngine.exportSTL();
        break;
    }
    HUD.updateCoords(AETHER.hand.coords);
  });
}


// ──────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  console.log(`%c AETHER_STUDIO v${AETHER.version} `, 'background:#050508;color:#00d4ff;font-size:14px;font-weight:bold;border:1px solid #00d4ff;padding:4px 12px;');
  ViewportEngine.init();
  bindControls();
  // Telemetry starts only on user gesture (camera permission)
  notify('AETHER_STUDIO ONLINE — CLICK CAMERA TO ACTIVATE TRACKING');
});
