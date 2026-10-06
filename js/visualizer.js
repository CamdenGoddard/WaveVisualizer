// The 3D scene: a glossy, rippling surface (inspired by the PS3 menu "wave",
// written from scratch) that reacts to the analyser's frequency data.
// Uses the global THREE build loaded in index.html.

const THREE = window.THREE;

const GRID_SIZE = 80;
const GRID_SEGMENTS = 120;
const SCENE_DURATION = 15; // seconds per camera scene

// Each scene is a camera pose plus how tall the side "canyon walls" get and
// how thick the fog is. The camera eases between them every SCENE_DURATION.
const SCENES = [
  { name: "canyon", cam: [0, 1.5, 15], look: [0, -1, -10], walls: 1.0, fog: 0.04, treble: 0.5 },
  { name: "ocean", cam: [0, 12, 10], look: [0, 0, -5], walls: 0.0, fog: 0.02, treble: 0.5 },
  { name: "dive", cam: [0, 0.5, 8], look: [0, 0.5, -15], walls: 0.3, fog: 0.08, treble: 1.5 }
];

function band(data, from, to) {
  const lo = Math.floor(from * data.length);
  const hi = Math.floor(to * data.length);
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += data[i];
  return hi > lo ? sum / (hi - lo) / 255 : 0;
}

// `getFrequencyData` returns a Uint8Array while audio is playing, or null.
export function startVisualizer(canvas, getFrequencyData) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 400);

  const geometry = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE, GRID_SEGMENTS, GRID_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x5fe3ff,
    metalness: 0.9,
    roughness: 0.15,
    side: THREE.DoubleSide
  });
  scene.add(new THREE.Mesh(geometry, material));

  scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  const light = new THREE.PointLight(0xffffff, 2, 50);
  light.position.set(0, 10, -10);
  scene.add(light);
  scene.fog = new THREE.FogExp2(0x000000, 0.04);

  camera.position.set(...SCENES[0].cam);
  const camTarget = new THREE.Vector3(...SCENES[0].cam);
  const lookTarget = new THREE.Vector3(...SCENES[0].look);
  const look = lookTarget.clone();
  camera.lookAt(look);

  const composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.2, 1.0, 0.1);
  composer.addPass(bloom);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  const bg = new THREE.Color();
  let sceneIdx = 0;
  let sceneTimer = 0;
  let walls = 1;
  let wallsTarget = 1;
  let fogTarget = 0.04;
  let t = 0;
  let bass = 0, mid = 0, treble = 0, bassAvg = 0.2;
  let beat = 0, lastBeat = -1;

  function nextScene() {
    sceneIdx = (sceneIdx + 1) % SCENES.length;
    const s = SCENES[sceneIdx];
    camTarget.set(...s.cam);
    lookTarget.set(...s.look);
    wallsTarget = s.walls;
    fogTarget = s.fog;
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    t += dt;
    sceneTimer += dt;
    if (sceneTimer > SCENE_DURATION) { nextScene(); sceneTimer = 0; }

    // Ease (lerp) the camera and scene settings toward the current scene.
    const ease = dt * 0.5;
    camera.position.lerp(camTarget, ease);
    look.lerp(lookTarget, ease);
    camera.lookAt(look);
    walls += (wallsTarget - walls) * ease;
    scene.fog.density += (fogTarget - scene.fog.density) * ease;

    // Split the spectrum into bass / mids / treble and smooth each one.
    const data = getFrequencyData();
    if (data) {
      const b = band(data, 0.0, 0.08);
      bass += (b - bass) * 0.15;
      mid += (band(data, 0.08, 0.4) - mid) * 0.15;
      treble += (band(data, 0.4, 1.0) - treble) * 0.15;
      bassAvg = bassAvg * 0.99 + b * 0.01;
      // Beat = bass jumps 35% above its running average (max ~3 per second).
      if (b > bassAvg * 1.35 && t - lastBeat > 0.3) { beat = 1; lastBeat = t; }
    } else {
      bass *= 0.95; mid *= 0.95; treble *= 0.95;
    }
    beat = Math.max(0, beat - dt * 1.5);

    // Color slowly cycles through hues; beats brighten it.
    const hue = (t * 0.02) % 1;
    material.color.setHSL(hue, 0.8, 0.5 + beat * 0.2);
    light.color.setHSL(hue, 1, 0.6);
    light.intensity = 2 + bass * 2 + beat * 1.5;
    bg.setHSL(hue, 0.6, (sceneIdx === 1 ? 0.08 : 0.03) + beat * 0.02);
    scene.background = bg;
    scene.fog.color.copy(bg);
    bloom.strength = 0.8 + bass * 1.5 + beat * 0.6;

    // Displace every vertex: two rolling base waves, canyon walls driven by
    // bass, and finer ripples driven by mids and treble.
    const pos = geometry.attributes.position;
    const scroll = t * 4 + bass * 1.5;
    const trebleGain = SCENES[sceneIdx].treble;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i) + scroll;
      let y = Math.sin(x * 0.15 + z * 0.15) * 1.2 + Math.cos(x * 0.2 - z * 0.1) * 0.8;
      const d = Math.abs(x);
      if (d > 4) y += Math.pow((d - 4) * 0.2, 1.5) * bass * 3.5 * walls;
      y += Math.sin(z * 0.8 + x * 1.2) * mid * 1.5;
      y += Math.cos(z * 2.0 - x * 1.5) * treble * trebleGain;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    composer.render();
  }

  frame();
}
