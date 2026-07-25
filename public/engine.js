/* ================================================================
   AETHER_STUDIO — Core Engine v0.2
   ================================================================
   Modules:
     1. ViewportEngine     — Three.js 3D scene, lighting, grid
     2. CursorEngine       — Mouse → 3D raycasting, ghost cursor
     3. DrawEngine         — Click-drag sculpting → extrusion
     4. TelemetryEngine    — MediaPipe hands → 3D coordinate matrix
     5. GestureInterpreter — Gesture classification & event dispatch
     6. ConstraintLayer    — Snapping, tolerances, dimensional math
     7. SceneManager       — Object lifecycle, history, undo
     8. ExportEngine       — STL compilation
     9. HUD                — Live readout & status
   ================================================================ */

'use strict';

const AETHER = {
  version:   '0.2.0',
  snapOn:    false,
  gridOn:    true,
  snapStep:  0.5,
  tool:      'sculpt',
  hand: {
    raw: null,
    coords:  { x: 0, y: 0, z: 0 },
    prev:    { x: 0, y: 0, z: 0 },
    gesture: 'IDLE',
    pinchActive:  false,
    spreadActive: false,
  },
  mouse: {
    world:    new THREE.Vector3(),
    drawing:  false,
    path:     [],
  },
  scene: {
    objects:  [],
    selected: null,
    history:  [],
  },
};


// ──────────────────────────────────────────────────────────────────
// 1. VIEWPORT ENGINE
// ──────────────────────────────────────────────────────────────────
const ViewportEngine = (() => {
  let renderer, scene, camera, controls, clock;
  let gridHelper, accentGrid;

  function init() {
    const canvas = document.getElementById('viewport');

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050508);
    scene.fog = new THREE.FogExp2(0x050508, 0.015);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(8, 6, 10);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 1;
    controls.maxDistance = 200;

    // Lights
    scene.add(new THREE.AmbientLight(0x101828, 3.5));
    const dir = new THREE.DirectionalLight(0x00d4ff, 2.5);
    dir.position.set(10, 20, 10);
    dir.castShadow = true;
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0x7b61ff, 1.4);
    rim.position.set(-8, 5, -8);
    scene.add(rim);

    buildGrid();

    // Axes
    const ax = new THREE.AxesHelper(2);
    ax.position.set(-9, 0.01, -9);
    scene.add(ax);

    clock = new THREE.Clock();
    window.addEventListener('resize', onResize);
    animate();
    console.log('[AETHER] ViewportEngine v0.2 ready');
  }

  function buildGrid() {
    if (gridHelper)  { scene.remove(gridHelper); gridHelper.geometry.dispose(); }
    if (accentGrid)  { scene.remove(accentGrid);  accentGrid.geometry.dispose(); }
    if (!AETHER.gridOn) return;

    gridHelper = new THREE.GridHelper(60, 120, 0x001828, 0x001020);
    gridHelper.material.opacity = 0.55;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    accentGrid = new THREE.GridHelper(60, 12, 0x004466, 0x002233);
    accentGrid.material.opacity = 0.3;
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
    controls.update();
    CursorEngine.update();
    TelemetryEngine.update();
    GestureInterpreter.update();
    renderer.render(scene, camera);
  }

  // ── Geometry helpers ──

  function placePoint(x, y, z, color = 0x00d4ff, size = 0.06) {
    const geo  = new THREE.SphereGeometry(size, 10, 10);
    const mat  = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.9,
      roughness: 0.15, metalness: 0.6,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    AETHER.scene.objects.push({ type: 'point', mesh });
    SceneManager.pushHistory('point', mesh);
    return mesh;
  }

  function placeLine(points, color = 0x00d4ff) {
    if (points.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    AETHER.scene.objects.push({ type: 'line', mesh: line });
    SceneManager.pushHistory('line', line);
    return line;
  }

  function extrudeProfile(points2D, height = 2.0, color = 0x7b61ff) {
    if (points2D.length < 3) return;
    const shape = new THREE.Shape();
    shape.moveTo(points2D[0].x, points2D[0].z);
    for (let i = 1; i < points2D.length; i++) shape.lineTo(points2D[i].x, points2D[i].z);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color).multiplyScalar(0.15),
      roughness: 0.25, metalness: 0.75,
      transparent: true, opacity: 0.88,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = true;
    scene.add(mesh);
    AETHER.scene.objects.push({ type: 'extrusion', mesh });
    SceneManager.pushHistory('extrusion', mesh);
    notify(`EXTRUSION CREATED — ${points2D.length} PTS  h=${height.toFixed(1)}`);
    return mesh;
  }

  function placeCylinder(cx, cy, cz, radius, height, color = 0x00d4ff) {
    radius = ConstraintLayer.snapValue(Math.max(radius, 0.1));
    height = ConstraintLayer.snapValue(Math.max(height, 0.2));
    const geo  = new THREE.CylinderGeometry(radius, radius, height, 36);
    const mat  = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color).multiplyScalar(0.1),
      roughness: 0.2, metalness: 0.85,
      transparent: true, opacity: 0.92,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy + height / 2, cz);
    mesh.castShadow = true;
    scene.add(mesh);
    AETHER.scene.objects.push({ type: 'cylinder', mesh, radius, height });
    SceneManager.pushHistory('cylinder', mesh);
    notify(`CYLINDER  r=${radius.toFixed(2)}  h=${height.toFixed(2)}`);
    return mesh;
  }

  function placeBox(cx, cy, cz, w, h, d, color = 0xff4b6e) {
    w = Math.max(ConstraintLayer.snapValue(w), 0.1);
    h = Math.max(ConstraintLayer.snapValue(h), 0.1);
    d = Math.max(ConstraintLayer.snapValue(d), 0.1);
    const geo  = new THREE.BoxGeometry(w, h, d);
    const mat  = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color).multiplyScalar(0.1),
      roughness: 0.3, metalness: 0.7,
      transparent: true, opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy + h / 2, cz);
    mesh.castShadow = true;
    scene.add(mesh);
    AETHER.scene.objects.push({ type: 'box', mesh, w, h, d });
    SceneManager.pushHistory('box', mesh);
    notify(`BOX  ${w.toFixed(1)} × ${h.toFixed(1)} × ${d.toFixed(1)}`);
    return mesh;
  }

  function clearScene() {
    for (const obj of AETHER.scene.objects) {
      scene.remove(obj.mesh);
      if (obj.mesh.geometry) obj.mesh.geometry.dispose();
      if (obj.mesh.material) obj.mesh.material.dispose();
    }
    AETHER.scene.objects = [];
    AETHER.scene.history = [];
    AETHER.scene.selected = null;
    notify('SCENE CLEARED');
  }

  function undoLast() {
    const last = AETHER.scene.history.pop();
    if (!last) { notify('NOTHING TO UNDO'); return; }
    scene.remove(last.mesh);
    if (last.mesh.geometry) last.mesh.geometry.dispose();
    AETHER.scene.objects = AETHER.scene.objects.filter(o => o.mesh !== last.mesh);
    notify('UNDO');
  }

  function toggleGrid() {
    AETHER.gridOn = !AETHER.gridOn;
    buildGrid();
  }

  function getScene()    { return scene; }
  function getCamera()   { return camera; }
  function getControls() { return controls; }

  return { init, placePoint, placeLine, extrudeProfile, placeCylinder, placeBox, clearScene, undoLast, toggleGrid, getScene, getCamera, getControls };
})();


// ──────────────────────────────────────────────────────────────────
// 2. CURSOR ENGINE — Mouse → 3D world, ghost orb
// ──────────────────────────────────────────────────────────────────
const CursorEngine = (() => {
  let ghost, ghostRing, raycaster, plane, mouse2D;
  let orbitEnabled = true;

  function init() {
    raycaster = new THREE.Raycaster();
    mouse2D   = new THREE.Vector2();

    // Ground plane for raycasting (y=0)
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Ghost orb
    const geoOrb  = new THREE.SphereGeometry(0.08, 16, 16);
    const matOrb  = new THREE.MeshStandardMaterial({
      color: 0x00d4ff, emissive: 0x00d4ff, emissiveIntensity: 1.2,
      transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.5,
    });
    ghost = new THREE.Mesh(geoOrb, matOrb);
    ghost.visible = false;
    ViewportEngine.getScene().add(ghost);

    // Ghost ring around orb
    const geoRing = new THREE.RingGeometry(0.14, 0.17, 32);
    const matRing = new THREE.MeshBasicMaterial({
      color: 0x00d4ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
    });
    ghostRing = new THREE.Mesh(geoRing, matRing);
    ghostRing.rotation.x = -Math.PI / 2;
    ghostRing.visible = false;
    ViewportEngine.getScene().add(ghostRing);

    // Mouse events
    const canvas = document.getElementById('viewport');
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup',   onMouseUp);
    canvas.addEventListener('mouseleave', () => { ghost.visible = false; ghostRing.visible = false; });

    // Right-click = undo
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); ViewportEngine.undoLast(); });
  }

  function onMouseMove(e) {
    mouse2D.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    mouse2D.y = -(e.clientY / window.innerHeight) * 2 + 1;

    const wp = getWorldPos();
    if (!wp) return;

    AETHER.mouse.world.copy(wp);
    AETHER.hand.coords = { x: wp.x, y: wp.y, z: wp.z };
    HUD.updateCoords(AETHER.hand.coords);

    ghost.position.copy(wp);
    ghostRing.position.set(wp.x, 0.01, wp.z);
    ghost.visible = true;
    ghostRing.visible = true;

    if (AETHER.mouse.drawing) {
      DrawEngine.addPoint(wp.clone());
    }
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    const wp = getWorldPos();
    if (!wp) return;

    // Disable orbit while drawing
    ViewportEngine.getControls().enabled = false;

    if (AETHER.tool === 'sculpt') {
      DrawEngine.startPath(wp.clone());
    } else if (AETHER.tool === 'box') {
      DrawEngine.startBox(wp.clone());
    } else if (AETHER.tool === 'point') {
      const snapped = AETHER.snapOn ? ConstraintLayer.snap3D(wp) : wp;
      ViewportEngine.placePoint(snapped.x, snapped.y, snapped.z);
    } else if (AETHER.tool === 'cylinder') {
      DrawEngine.startCylinder(wp.clone());
    }
  }

  function onMouseUp(e) {
    if (e.button !== 0) return;
    ViewportEngine.getControls().enabled = true;

    if (AETHER.tool === 'sculpt') {
      DrawEngine.finishPath();
    } else if (AETHER.tool === 'box') {
      DrawEngine.finishBox();
    } else if (AETHER.tool === 'cylinder') {
      DrawEngine.finishCylinder();
    }
  }

  function getWorldPos() {
    const camera = ViewportEngine.getCamera();
    raycaster.setFromCamera(mouse2D, camera);
    const target = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, target);
    if (!hit) return null;
    if (AETHER.snapOn) return ConstraintLayer.snap3D(target);
    return target;
  }

  function update() {
    // Pulse ghost
    if (ghost.visible) {
      const t = performance.now() * 0.003;
      ghost.material.emissiveIntensity = 0.9 + Math.sin(t) * 0.3;
      ghost.scale.setScalar(1 + Math.sin(t * 1.3) * 0.05);
    }
  }

  return { init, update, getWorldPos };
})();


// ──────────────────────────────────────────────────────────────────
// 3. DRAW ENGINE — Click-drag sculpting
// ──────────────────────────────────────────────────────────────────
const DrawEngine = (() => {
  let previewLine   = null;
  let previewPoints = [];
  let previewBox    = null;
  let boxStart      = null;
  let cylStart      = null;
  let cylPreview    = null;

  const MIN_PTS = 3;
  const MIN_DIST = 0.12;

  function startPath(pt) {
    AETHER.mouse.drawing = true;
    previewPoints = [pt];
    // Start preview line
    const geo = new THREE.BufferGeometry().setFromPoints([pt, pt]);
    const mat = new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.6 });
    previewLine = new THREE.Line(geo, mat);
    ViewportEngine.getScene().add(previewLine);
    notify('DRAWING — release to extrude');
  }

  function addPoint(pt) {
    if (!AETHER.mouse.drawing) return;
    const last = previewPoints[previewPoints.length - 1];
    if (last && pt.distanceTo(last) < MIN_DIST) return;
    previewPoints.push(pt);

    // Update preview line
    if (previewLine) {
      ViewportEngine.getScene().remove(previewLine);
      previewLine.geometry.dispose();
      const geo = new THREE.BufferGeometry().setFromPoints(previewPoints);
      previewLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.6 }));
      ViewportEngine.getScene().add(previewLine);
    }
  }

  function finishPath() {
    AETHER.mouse.drawing = false;
    if (previewLine) {
      ViewportEngine.getScene().remove(previewLine);
      previewLine.geometry.dispose();
      previewLine = null;
    }
    if (previewPoints.length < MIN_PTS) {
      // Too short — place a single point instead
      if (previewPoints.length > 0) {
        const p = previewPoints[0];
        ViewportEngine.placePoint(p.x, p.y, p.z);
      }
      previewPoints = [];
      return;
    }
    // Extrude the profile
    ViewportEngine.extrudeProfile(previewPoints, 1.5, 0x7b61ff);
    previewPoints = [];
  }

  // Box: click drag defines XZ footprint
  function startBox(pt) {
    AETHER.mouse.drawing = true;
    boxStart = pt.clone();
    const geo = new THREE.BoxGeometry(0.1, 1, 0.1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff4b6e, transparent: true, opacity: 0.4, wireframe: true });
    previewBox = new THREE.Mesh(geo, mat);
    previewBox.position.copy(pt);
    ViewportEngine.getScene().add(previewBox);
    notify('BOX — drag to size, release to place');
  }

  function addPoint(pt) {
    if (!AETHER.mouse.drawing) return;

    if (AETHER.tool === 'sculpt') {
      const last = previewPoints[previewPoints.length - 1];
      if (last && pt.distanceTo(last) < MIN_DIST) return;
      previewPoints.push(pt);
      if (previewLine) {
        ViewportEngine.getScene().remove(previewLine);
        previewLine.geometry.dispose();
        const geo = new THREE.BufferGeometry().setFromPoints(previewPoints);
        previewLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.6 }));
        ViewportEngine.getScene().add(previewLine);
      }
    } else if (AETHER.tool === 'box' && boxStart && previewBox) {
      const w = Math.abs(pt.x - boxStart.x) || 0.1;
      const d = Math.abs(pt.z - boxStart.z) || 0.1;
      previewBox.scale.set(w * 10, 1, d * 10);
      previewBox.position.set(
        (pt.x + boxStart.x) / 2,
        0.5,
        (pt.z + boxStart.z) / 2
      );
    } else if (AETHER.tool === 'cylinder' && cylStart && cylPreview) {
      const r = Math.max(pt.distanceTo(cylStart), 0.1);
      cylPreview.scale.set(r * 10, 1, r * 10);
    }
  }

  function finishBox() {
    AETHER.mouse.drawing = false;
    const wp = AETHER.mouse.world;
    if (previewBox) {
      ViewportEngine.getScene().remove(previewBox);
      previewBox.geometry.dispose();
      previewBox = null;
    }
    if (!boxStart) return;
    const w = Math.abs(wp.x - boxStart.x) || 0.5;
    const d = Math.abs(wp.z - boxStart.z) || 0.5;
    const h = Math.max(w, d);
    ViewportEngine.placeBox(
      (wp.x + boxStart.x) / 2, 0,
      (wp.z + boxStart.z) / 2,
      w, h, d, 0xff4b6e
    );
    boxStart = null;
  }

  function startCylinder(pt) {
    AETHER.mouse.drawing = true;
    cylStart = pt.clone();
    const geo = new THREE.CylinderGeometry(0.1, 0.1, 1, 32);
    const mat = new THREE.MeshStandardMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.35, wireframe: true });
    cylPreview = new THREE.Mesh(geo, mat);
    cylPreview.position.copy(pt);
    ViewportEngine.getScene().add(cylPreview);
    notify('CYLINDER — drag to set radius, release to place');
  }

  function finishCylinder() {
    AETHER.mouse.drawing = false;
    const wp = AETHER.mouse.world;
    if (cylPreview) {
      ViewportEngine.getScene().remove(cylPreview);
      cylPreview.geometry.dispose();
      cylPreview = null;
    }
    if (!cylStart) return;
    const r = Math.max(wp.distanceTo(cylStart), 0.15);
    ViewportEngine.placeCylinder(cylStart.x, 0, cylStart.z, r, r * 2.5, 0x00d4ff);
    cylStart = null;
  }

  return { startPath, addPoint, finishPath, startBox, finishBox, startCylinder, finishCylinder };
})();


// ──────────────────────────────────────────────────────────────────
// 4. TELEMETRY ENGINE (Webcam → 3D)
// ──────────────────────────────────────────────────────────────────
const TelemetryEngine = (() => {
  let hands, cam, trackingCtx;
  const SMOOTH = 5;
  let buf = [];
  const DEPTH_SCALE = 6, SPACE_SCALE = 10;

  function init() {
    const video  = document.getElementById('webcam');
    const canvas = document.getElementById('tracking-canvas');
    trackingCtx  = canvas.getContext('2d');

    hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.6 });
    hands.onResults(onResults);

    cam = new Camera(video, {
      onFrame: async () => { await hands.send({ image: video }); },
      width: 640, height: 480,
    });
    cam.start().then(() => {
      HUD.setTrackingStatus('online');
      notify('OPTICAL TELEMETRY ONLINE');
    }).catch(() => {
      HUD.setTrackingStatus('offline');
      notify('CAMERA DENIED — MOUSE MODE ACTIVE');
    });
  }

  function onResults(results) {
    const canvas = document.getElementById('tracking-canvas');
    trackingCtx.clearRect(0, 0, canvas.width, canvas.height);
    if (!results.multiHandLandmarks?.length) {
      AETHER.hand.raw = null;
      GestureInterpreter.onNoHand();
      return;
    }
    const lm = results.multiHandLandmarks[0];
    AETHER.hand.raw = lm;
    HUD.setTrackingStatus('tracking');

    drawConnectors(trackingCtx, lm, HAND_CONNECTIONS, { color: 'rgba(0,212,255,0.6)', lineWidth: 1.5 });
    drawLandmarks(trackingCtx, lm, { color: 'rgba(123,97,255,0.9)', lineWidth: 1, radius: 3 });

    const rawX = (0.5 - lm[0].x) * SPACE_SCALE;
    const rawY = -(lm[0].y - 0.5) * SPACE_SCALE;
    const rawZ = -lm[0].z * DEPTH_SCALE;

    buf.push({ x: rawX, y: rawY, z: rawZ });
    if (buf.length > SMOOTH) buf.shift();
    const s = buf.reduce((a, f) => ({ x: a.x + f.x / SMOOTH, y: a.y + f.y / SMOOTH, z: a.z + f.z / SMOOTH }), { x:0,y:0,z:0 });

    AETHER.hand.prev   = { ...AETHER.hand.coords };
    AETHER.hand.coords = AETHER.snapOn ? ConstraintLayer.snap3D(s) : s;
    GestureInterpreter.onLandmarks(lm);
  }

  function update() {}

  return { init, update };
})();


// ──────────────────────────────────────────────────────────────────
// 5. GESTURE INTERPRETER
// ──────────────────────────────────────────────────────────────────
const GestureInterpreter = (() => {
  let state = 'IDLE';
  let lastPlace = 0;

  function dist(a, b) { return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2); }

  function classify(lm) {
    if (dist(lm[4], lm[8]) < 0.05)  return 'PINCH';
    if (dist(lm[4], lm[20]) > 0.35) return 'SPREAD';
    const iExt = dist(lm[8], lm[5]) > 0.12;
    const mCur = dist(lm[12], lm[9]) < 0.09;
    if (iExt && mCur) return 'POINT';
    if (dist(lm[0], lm[9]) < 0.10)  return 'FIST';
    return 'IDLE';
  }

  function onLandmarks(lm) {
    const g  = classify(lm);
    const c  = AETHER.hand.coords;
    const now = Date.now();

    HUD.updateCoords(c);
    HUD.setGesture(g);

    if (g === 'PINCH' && state !== 'PINCH') {
      notify('PINCH — GRAB');
    }
    if (g === 'SPREAD' && now - lastPlace > 1200) {
      const r = dist(lm[4], lm[20]) * 8;
      ViewportEngine.placeCylinder(c.x, Math.max(c.y, 0), c.z, r, r * 2);
      lastPlace = now;
    }
    if (g === 'POINT' && now - lastPlace > 500) {
      ViewportEngine.placePoint(c.x, Math.max(c.y, 0), c.z);
      lastPlace = now;
    }
    state = g;
  }

  function onNoHand() {
    document.getElementById('gesture-ring').classList.add('hidden');
    HUD.setGesture('IDLE');
    HUD.setTrackingStatus('online');
    state = 'IDLE';
  }

  function update() {}

  return { onLandmarks, onNoHand, update };
})();


// ──────────────────────────────────────────────────────────────────
// 6. CONSTRAINT LAYER
// ──────────────────────────────────────────────────────────────────
const ConstraintLayer = (() => {
  function snapValue(val) {
    if (!AETHER.snapOn) return val;
    return Math.round(val / AETHER.snapStep) * AETHER.snapStep;
  }
  function snap3D(v) {
    return { x: snapValue(v.x), y: snapValue(v.y ?? 0), z: snapValue(v.z) };
  }
  function toMM(u) { return (u * 10).toFixed(1) + 'mm'; }
  function distanceMM(a, b) {
    return toMM(Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2));
  }
  return { snapValue, snap3D, toMM, distanceMM };
})();


// ──────────────────────────────────────────────────────────────────
// 7. SCENE MANAGER
// ──────────────────────────────────────────────────────────────────
const SceneManager = (() => {
  function pushHistory(type, mesh) {
    AETHER.scene.history.push({ type, mesh });
  }
  return { pushHistory };
})();


// ──────────────────────────────────────────────────────────────────
// 8. EXPORT ENGINE
// ──────────────────────────────────────────────────────────────────
const ExportEngine = (() => {
  function exportSTL() {
    const meshes = AETHER.scene.objects
      .filter(o => o.type !== 'point' && o.type !== 'line')
      .map(o => o.mesh);

    if (!meshes.length) { notify('NO SOLID GEOMETRY TO EXPORT'); return; }

    let stl = 'solid aether_export\n';
    for (const mesh of meshes) {
      mesh.updateMatrixWorld();
      const geo  = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const iGeo = geo.index ? geo.toNonIndexed() : geo;
      const pos  = iGeo.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        const v = [0,1,2].map(j => new THREE.Vector3(pos.getX(i+j), pos.getY(i+j), pos.getZ(i+j)));
        const n = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(v[1], v[0]),
          new THREE.Vector3().subVectors(v[2], v[0])
        ).normalize();
        stl += `  facet normal ${f(n.x)} ${f(n.y)} ${f(n.z)}\n    outer loop\n`;
        v.forEach(vv => { stl += `      vertex ${f(vv.x)} ${f(vv.y)} ${f(vv.z)}\n`; });
        stl += '    endloop\n  endfacet\n';
      }
    }
    stl += 'endsolid aether_export\n';
    dl('aether_export.stl', stl);
    notify(`STL EXPORTED — ${meshes.length} SOLID(S)`);
  }

  function f(v) { return v.toFixed(6); }
  function dl(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return { exportSTL };
})();


// ──────────────────────────────────────────────────────────────────
// 9. HUD
// ──────────────────────────────────────────────────────────────────
const HUD = (() => {
  const elX   = document.getElementById('coord-x');
  const elY   = document.getElementById('coord-y');
  const elZ   = document.getElementById('coord-z');
  const elG   = document.getElementById('gesture-label');
  const elSn  = document.getElementById('snap-label');
  const elSt  = document.getElementById('status-tracking');
  const elStL = document.getElementById('status-label');

  function updateCoords(c) {
    elX.textContent = ((c.x || 0) * 10).toFixed(1) + 'mm';
    elY.textContent = ((c.y || 0) * 10).toFixed(1) + 'mm';
    elZ.textContent = ((c.z || 0) * 10).toFixed(1) + 'mm';
  }
  function setGesture(g) { elG.textContent = 'GESTURE: ' + g; }
  function setSnapStatus(on) {
    elSn.textContent = 'SNAP: ' + (on ? 'ON' : 'OFF');
    elSn.className   = on ? 'on' : '';
  }
  function setTrackingStatus(s) {
    elSt.className = 'status-dot ' + s;
    elStL.textContent = s === 'tracking' ? 'HAND DETECTED' : s === 'online' ? 'TRACKING READY' : 'MOUSE MODE';
  }

  return { updateCoords, setGesture, setSnapStatus, setTrackingStatus };
})();


// ──────────────────────────────────────────────────────────────────
// NOTIFICATION
// ──────────────────────────────────────────────────────────────────
let _nTimeout;
function notify(msg) {
  const el = document.getElementById('notification');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_nTimeout);
  _nTimeout = setTimeout(() => el.classList.remove('show'), 2400);
}


// ──────────────────────────────────────────────────────────────────
// CONTROL BINDINGS
// ──────────────────────────────────────────────────────────────────
function bindControls() {
  // Toolbar
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'clear') { ViewportEngine.clearScene(); return; }
      if (btn.dataset.tool === 'undo')  { ViewportEngine.undoLast();   return; }
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AETHER.tool = btn.dataset.tool;
      const labels = { sculpt:'SCULPT MODE', point:'POINT MODE', box:'BOX MODE', cylinder:'CYLINDER MODE', measure:'MEASURE MODE' };
      notify(labels[AETHER.tool] || AETHER.tool.toUpperCase());
    });
  });

  // Snap
  const btnSnap = document.getElementById('btn-snap');
  btnSnap.addEventListener('click', () => {
    AETHER.snapOn = !AETHER.snapOn;
    btnSnap.textContent = AETHER.snapOn ? 'SNAP ON' : 'SNAP OFF';
    btnSnap.classList.toggle('snap-active', AETHER.snapOn);
    HUD.setSnapStatus(AETHER.snapOn);
    notify('SNAP ' + (AETHER.snapOn ? 'ENABLED — 0.5 UNIT GRID' : 'DISABLED'));
  });

  // Grid
  const btnGrid = document.getElementById('btn-grid');
  btnGrid.addEventListener('click', () => {
    AETHER.gridOn = !AETHER.gridOn;
    ViewportEngine.toggleGrid();
    btnGrid.textContent = AETHER.gridOn ? 'GRID ON' : 'GRID OFF';
    btnGrid.classList.toggle('active', AETHER.gridOn);
  });

  // Camera
  document.getElementById('btn-camera').addEventListener('click', TelemetryEngine.init);

  // Export
  document.getElementById('btn-export').addEventListener('click', ExportEngine.exportSTL);

  // Keyboard shortcuts
  window.addEventListener('keydown', e => {
    switch(e.key) {
      case 'z': case 'Z': if (e.ctrlKey || e.metaKey) { e.preventDefault(); ViewportEngine.undoLast(); } break;
      case 's': case 'S': if (!e.ctrlKey) { AETHER.snapOn = !AETHER.snapOn; HUD.setSnapStatus(AETHER.snapOn); document.getElementById('btn-snap').textContent = AETHER.snapOn?'SNAP ON':'SNAP OFF'; document.getElementById('btn-snap').classList.toggle('snap-active', AETHER.snapOn); } break;
      case 'e': case 'E': ExportEngine.exportSTL(); break;
      case 'g': case 'G': AETHER.gridOn=!AETHER.gridOn; ViewportEngine.toggleGrid(); break;
      case 'Delete': case 'Backspace': ViewportEngine.undoLast(); break;
      case '1': setTool('sculpt');   break;
      case '2': setTool('point');    break;
      case '3': setTool('box');      break;
      case '4': setTool('cylinder'); break;
    }
  });

  function setTool(t) {
    AETHER.tool = t;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    notify('TOOL: ' + t.toUpperCase());
  }
}


// ──────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  console.log(`%c AETHER_STUDIO v${AETHER.version} `, 'background:#050508;color:#00d4ff;font-size:14px;font-weight:bold;padding:4px 12px;border:1px solid #00d4ff;');
  ViewportEngine.init();
  CursorEngine.init();
  bindControls();
  HUD.setTrackingStatus('offline');
  notify('AETHER_STUDIO v0.2 — MOUSE MODE ACTIVE');
});
