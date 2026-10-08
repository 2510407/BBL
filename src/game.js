
(() => {
  const A = window.ASSET_DATA;
  const $ = (id) => document.getElementById(id);

  const RENDER_SCALE = 0.90;
  const TARGET_FPS = 45;
  const FRAME_TIME = 1 / TARGET_FPS;

  // TEMP: manual placement mode for calibrating player coordinates.
  const POSITION_EDIT_MODE = false;
  const MOVE_STEP = 0.10;      // meters
  const MOVE_STEP_FINE = 0.02; // Alt
  const MOVE_STEP_COARSE = 0.50; // Shift

  // Final manual calibration from in-game editor.
  const FINAL_PITCHER_POS = new THREE.Vector3(-0.040, 0.250, -19.820);
  const FINAL_BATTER_POS  = new THREE.Vector3(-2.656, 0.010, 1.444);
  const FINAL_PITCHER_ROT_Y = 0;
  const FINAL_BATTER_ROT_Y = Math.PI;
  const FINAL_PLAYER_SCALE = 1.750;

  // Pitch animation sync tuning.
  // The ball stays attached to the throwing hand until this normalized
  // animation time, then detaches from the exact hand world position.
  let PITCH_RELEASE_NORM = 0.38;
  const BALL_HAND_OFFSET = new THREE.Vector3(-0.012, -0.176, 0.002);

  // TEMP: bat / glove transform editor.
  const EQUIPMENT_EDIT_MODE = true;

  // TEMP: ball visual-size editor.
  const BALL_EDIT_MODE = false;
  const REAL_BALL_DIAMETER = 0.074; // 7.4 cm
  let BALL_VISUAL_SCALE = 3.600;
  const BALL_SCALE_STEPS = [0.05, 0.10, 0.25];

  const EQUIP_MOVE_STEPS = [0.005, 0.010, 0.050];
  const EQUIP_ROT_STEPS = [1, 5, 15];
  const EQUIP_SCALE_STEPS = [0.01, 0.05, 0.10];

  const CALIBRATED_BAT_OFFSET = new THREE.Vector3(0.000, 0.000, 0.000);
  const CALIBRATED_BAT_ROT = new THREE.Vector3(12.9, -60.0, 50.0);

  const CALIBRATED_GLOVE_OFFSET = new THREE.Vector3(-0.035, -0.160, 0.020);
  const CALIBRATED_GLOVE_ROT = new THREE.Vector3(55.0, -40.0, 35.0);

  const FIELD_FILE_NOTE = "현재 Baseball Field.fbx = 단순 잔디/흙 필드 모델";
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87bfe5);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 400);
  camera.position.set(-0.35, 1.95, 5.0);
  camera.lookAt(0, 1.05, -13.5);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.15));
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.style.outline = "none";

  function resizeRenderer() {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(
      Math.max(320, Math.floor(w * RENDER_SCALE)),
      Math.max(220, Math.floor(h * RENDER_SCALE)),
      false
    );
    renderer.domElement.style.width = w + "px";
    renderer.domElement.style.height = h + "px";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resizeRenderer();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x31502c, 0.32));
  const sun = new THREE.DirectionalLight(0xffffff, 0.22);
  sun.position.set(10, 18, 8);
  scene.add(sun);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.05, -13.5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3.5;
  controls.maxDistance = 45;

  const loader = new THREE.FBXLoader();
  const textureLoader = new THREE.TextureLoader();
  const clock = new THREE.Clock();

  const state = {
    batter: null,
    pitcher: null,
    bat: null,
    glove: null,
    ball: null,
    batterMixer: null,
    pitcherMixer: null,
    batterIdle: null,
    pitcherIdle: null,
    swingAction: null,
    pitchAction: null,
    pitcherThrowHand: null,
    pitching: false,
    pitchReleased: false,
    pitchT: 0,
    swingWindow: 0,
    hit: false,
    ballVelocity: new THREE.Vector3(),
    ballAirborne: false,
    pitchStart: new THREE.Vector3(0, 1.68, -17.75),
    pitchEnd: new THREE.Vector3(0.12, 0.98, 0.05),
    fpsFrames: 0,
    fpsTime: 0,
    fieldAnchors: null,
    batterStart: new THREE.Vector3(0.9, 0, 0),
    pitcherStart: new THREE.Vector3(0, 0, -18.44),
    selectedActor: null,
    selectionHelper: null,
    editStep: MOVE_STEP,
    scaleStep: 0.05,
    selectedEquipment: null,
    equipMoveStep: 0.010,
    equipRotStep: 5,
    equipScaleStep: 0.05,
    ballScaleStep: 0.10,
    ballMoveStep: 0.010
  };

  function b64ToBuffer(b64) {
    const raw = atob(b64);
    const a = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i);
    return a.buffer;
  }

  function parseFBX(key) {
    if (!A[key]) throw new Error("missing asset: " + key);
    return loader.parse(b64ToBuffer(A[key]), "");
  }

  function scaleToHeight(obj, height) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 0.0001) {
      obj.scale.multiplyScalar(height / size.y);
      obj.updateMatrixWorld(true);
    }
  }

  function getPlayerBounds(actor) {
    actor.updateMatrixWorld(true);
    const total = new THREE.Box3();
    let found = false;

    actor.traverse((o) => {
      if (!o.visible || !o.isSkinnedMesh) return;
      const b = new THREE.Box3().setFromObject(o);
      if (!b.isEmpty()) {
        if (!found) total.copy(b);
        else total.union(b);
        found = true;
      }
    });

    if (!found) return new THREE.Box3().setFromObject(actor);
    return total;
  }

  function scalePlayerToHeight(actor, height) {
    const b = getPlayerBounds(actor);
    const s = new THREE.Vector3();
    b.getSize(s);
    if (s.y > 0.0001) {
      actor.scale.multiplyScalar(height / s.y);
      actor.updateMatrixWorld(true);
    }
  }

  function snapPlayerToGround(actor, groundY = 0) {
    actor.updateMatrixWorld(true);
    const b = getPlayerBounds(actor);
    if (!b.isEmpty() && Number.isFinite(b.min.y)) {
      actor.position.y += groundY - b.min.y;
      actor.updateMatrixWorld(true);
    }
  }

  function scaleToSize(obj, maxSize) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const m = Math.max(size.x, size.y, size.z);
    if (m > 0.0001) {
      obj.scale.multiplyScalar(maxSize / m);
      obj.updateMatrixWorld(true);
    }
  }

  function placeOnGround(obj, pos) {
    obj.position.set(pos.x, 0, pos.z);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.y += pos.y - box.min.y;
    obj.updateMatrixWorld(true);
  }

  function firstClip(key) {
    try {
      const f = parseFBX(key);
      return f.animations && f.animations[0] ? f.animations[0] : null;
    } catch (e) {
      console.warn(e);
      return null;
    }
  }

  function findBone(obj, token) {
    const target = token.toLowerCase().replace(/[^a-z]/g, "");
    let found = null;
    obj.traverse((o) => {
      if (found || !o.isBone) return;
      const n = (o.name || "").toLowerCase().replace(/[^a-z]/g, "");
      if (n.includes(target)) found = o;
    });
    return found;
  }

  function fitAttachedWorldSize(obj, targetSize) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const current = Math.max(size.x, size.y, size.z);

    if (current > 0.000001) {
      obj.scale.multiplyScalar(targetSize / current);
      obj.updateMatrixWorld(true);
    }
  }

  function setBoneLocalOffsetInWorldUnits(obj, bone, worldOffset) {
    // Convert a WORLD-axis offset around the hand into the hand bone's
    // local coordinates. The old version divided only by scale, so a rotated
    // hand made the UI axes behave incorrectly / appear not to move.
    bone.updateMatrixWorld(true);

    const boneWorld = new THREE.Vector3();
    bone.getWorldPosition(boneWorld);

    const targetWorld = boneWorld.clone().add(worldOffset);
    const targetLocal = bone.worldToLocal(targetWorld.clone());

    obj.position.copy(targetLocal);
    obj.updateMatrixWorld(true);
  }

  function attachProp(prop, actor, boneName, targetWorldSize, worldOffset) {
    const bone = findBone(actor, boneName);
    if (!bone) {
      console.warn("bone not found:", boneName);
      return null;
    }

    bone.add(prop);
    prop.position.set(0, 0, 0);
    prop.rotation.set(0, 0, 0);
    prop.updateMatrixWorld(true);

    // Props were being scaled before parenting. The player root itself is
    // heavily scaled down from FBX centimeters, so that made the props almost
    // microscopic once attached. Size them AFTER parenting in world units.
    fitAttachedWorldSize(prop, targetWorldSize);

    if (worldOffset) setBoneLocalOffsetInWorldUnits(prop, bone, worldOffset);

    prop.userData.attachBone = bone;
    prop.userData.worldOffset = worldOffset ? worldOffset.clone() : new THREE.Vector3();
    prop.userData.localAttachPosition = prop.position.clone();
    prop.userData.baseWorldSize = targetWorldSize || 1;
    prop.userData.equipmentScale = 1.0;
    return bone;
  }



  function attachBallToThrowingHand() {
    if (!state.ball || !state.pitcherThrowHand) return;

    state.pitcherThrowHand.add(state.ball);
    state.ball.position.set(0, 0, 0);
    state.ball.rotation.set(0, 0, 0);
    state.ball.scale.set(1, 1, 1);
    state.ball.updateMatrixWorld(true);

    // Baseball diameter ~7.4 cm in world space. This compensation is crucial:
    // otherwise the player's FBX root scale also shrinks the ball to a dot.
    fitAttachedWorldSize(state.ball, REAL_BALL_DIAMETER * BALL_VISUAL_SCALE);
    setBoneLocalOffsetInWorldUnits(
      state.ball,
      state.pitcherThrowHand,
      BALL_HAND_OFFSET
    );

    state.pitchReleased = false;
  }

  function releaseBallFromThrowingHand() {
    if (!state.ball || !state.pitcherThrowHand || state.pitchReleased) return;

    // scene.attach preserves the ball's world position, rotation AND scale.
    // So it does not suddenly change size when leaving the scaled hand rig.
    scene.attach(state.ball);
    state.ball.updateMatrixWorld(true);

    const worldPos = new THREE.Vector3();
    state.ball.getWorldPosition(worldPos);
    state.ball.position.copy(worldPos);

    state.pitchStart.copy(worldPos);
    state.pitchReleased = true;
    state.pitchT = 0;

    const travel = 0.46;
    state.ballVelocity
      .copy(state.pitchEnd)
      .sub(worldPos)
      .multiplyScalar(1 / travel);

    state.ballVelocity.y += 0.5 * 9.81 * travel;
  }

  function actorLabel(actor) {
    if (actor === state.batter) return "BATTER";
    if (actor === state.pitcher) return "PITCHER";
    return "NONE";
  }

  function getEditStep(e) {
    if (e && e.shiftKey) return MOVE_STEP_COARSE;
    if (e && e.altKey) return MOVE_STEP_FINE;
    return state.editStep || MOVE_STEP;
  }


  function getEditorScale(actor) {
    if (!actor) return 1;
    if (actor.userData.editorScale == null) actor.userData.editorScale = 1;
    return actor.userData.editorScale;
  }

  function scaleSelected(delta) {
    const a = state.selectedActor;
    if (!a) return;

    const oldScale = getEditorScale(a);
    const newScale = Math.max(0.20, Math.min(3.00, oldScale + delta));
    const factor = newScale / oldScale;

    // Keep the player's feet at the same world height while scaling.
    const before = getPlayerBounds(a);
    const beforeMinY = before.min.y;

    a.scale.multiplyScalar(factor);
    a.userData.editorScale = newScale;
    a.updateMatrixWorld(true);

    const after = getPlayerBounds(a);
    if (!after.isEmpty() && Number.isFinite(beforeMinY) && Number.isFinite(after.min.y)) {
      a.position.y += beforeMinY - after.min.y;
      a.updateMatrixWorld(true);
    }

    if (state.selectionHelper) state.selectionHelper.update();
    updateCoordPanel();
  }

  function updateCoordPanel() {
    const panel = document.getElementById("coordPanel");
    if (!panel) return;

    const a = state.selectedActor;
    if (!a) {
      panel.innerHTML =
        "<b>위치 조정 모드</b><br>" +
        "선수 클릭 → 선택<br>" +
        "←/→ X · ↑/↓ Z · PageUp/PageDown Y<br>" +
        "Shift=0.50m · 기본=0.10m · Alt=0.02m";
      return;
    }

    const p = a.position;
    const r = a.rotation;
    panel.innerHTML =
      "<b>" + actorLabel(a) + "</b><br>" +
      "X: " + p.x.toFixed(3) + "<br>" +
      "Y: " + p.y.toFixed(3) + "<br>" +
      "Z: " + p.z.toFixed(3) + "<br>" +
      "RotY: " + THREE.MathUtils.radToDeg(r.y).toFixed(1) + "°<br>" +
      "Scale: " + getEditorScale(a).toFixed(2) + "x<br>" +
      "Move Step: " + state.editStep.toFixed(2) + "m<br>" +
      "Scale Step: " + state.scaleStep.toFixed(2) + "x<br>" +
      "<span style='opacity:.75'>←/→ X · ↑/↓ Z · PgUp/PgDn 또는 E/Q = Y · [ ] = 크기</span>";
  }

  function refreshSelectionHelper() {
    if (state.selectionHelper) {
      scene.remove(state.selectionHelper);
      state.selectionHelper.geometry && state.selectionHelper.geometry.dispose();
      state.selectionHelper.material && state.selectionHelper.material.dispose();
      state.selectionHelper = null;
    }
    if (!state.selectedActor) return;

    state.selectionHelper = new THREE.BoxHelper(state.selectedActor, 0xffff00);
    scene.add(state.selectionHelper);
  }

  function selectActor(actor) {
    state.selectedActor = actor;
    refreshSelectionHelper();
    updateCoordPanel();
  }

  function moveSelected(dx, dy, dz) {
    const a = state.selectedActor;
    if (!a) return;

    a.position.x += dx;
    a.position.y += dy;
    a.position.z += dz;
    a.updateMatrixWorld(true);

    if (state.selectionHelper) state.selectionHelper.update();
    updateCoordPanel();
  }

  function copySelectedCoords() {
    const a = state.selectedActor;
    if (!a) return;

    const p = a.position;
    const text =
      actorLabel(a) +
      " x=" + p.x.toFixed(3) +
      " y=" + p.y.toFixed(3) +
      " z=" + p.z.toFixed(3) +
      " rotY=" + THREE.MathUtils.radToDeg(a.rotation.y).toFixed(1) +
      " scale=" + getEditorScale(a).toFixed(3);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setStatus(text);
  }

  function setStatus(t) {
    $("status").textContent = t;
  }

  function stripOversizedFlatMeshes(obj) {
    // Mixamo 원본 캐릭터에 같이 딸려온 거대한 바닥/배경 메쉬 제거.
    // 사람 몸 높이에 비해 X/Z만 비정상적으로 넓고 Y가 얇은 메쉬만 숨긴다.
    obj.updateMatrixWorld(true);

    const full = new THREE.Box3().setFromObject(obj);
    const fullSize = new THREE.Vector3();
    full.getSize(fullSize);
    const bodyH = Math.max(fullSize.y, 0.001);

    const junk = [];

    obj.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;

      const b = new THREE.Box3().setFromObject(o);
      const s = new THREE.Vector3();
      b.getSize(s);

      const flatAndHuge =
        (s.x > bodyH * 2.15 || s.z > bodyH * 2.15) &&
        s.y < bodyH * 0.42;

      const suspiciousName = /plane|ground|floor|background|backdrop/i.test(o.name || "");

      if (flatAndHuge || suspiciousName) {
        junk.push(o);
      }
    });

    junk.forEach((o) => {
      o.visible = false;
    });

    return junk.length;
  }


  function findNamedMesh(root, token) {
    const q = token.toLowerCase();
    let found = null;
    root.traverse((o) => {
      if (found || !o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      const own = (o.name || "").toLowerCase();
      const parent = (o.parent && o.parent.name ? o.parent.name : "").toLowerCase();
      if (own.includes(q) || parent.includes(q)) found = o;
    });
    return found;
  }

  function kMeansFourCenters(mesh) {
    const attr = mesh.geometry.attributes.position;
    if (!attr || attr.count < 4) return null;

    const pts = [];
    for (let i = 0; i < attr.count; i++) {
      pts.push(new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i)));
    }

    // Farthest-point initialization makes the four disconnected bases
    // separate cleanly even when FBX duplicates vertices.
    const centers = [pts[0].clone()];
    while (centers.length < 4) {
      let best = pts[0], bestD = -1;
      for (const p of pts) {
        let d = Infinity;
        for (const cen of centers) d = Math.min(d, p.distanceToSquared(cen));
        if (d > bestD) { bestD = d; best = p; }
      }
      centers.push(best.clone());
    }

    for (let iter = 0; iter < 12; iter++) {
      const sums = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      const counts = [0,0,0,0];

      for (const p of pts) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < 4; i++) {
          const d = p.distanceToSquared(centers[i]);
          if (d < bd) { bd = d; bi = i; }
        }
        sums[bi].add(p);
        counts[bi]++;
      }

      for (let i = 0; i < 4; i++) {
        if (counts[i]) centers[i].copy(sums[i].multiplyScalar(1 / counts[i]));
      }
    }
    return centers;
  }

  function readBaseAnchors(field) {
    const bases = findNamedMesh(field, "bases");
    if (!bases) return null;

    const localCenters = kMeansFourCenters(bases);
    if (!localCenters) return null;

    // In this downloaded model Home is the base cluster nearest geometry origin.
    let homeIdx = 0;
    let homeLen = Infinity;
    for (let i = 0; i < localCenters.length; i++) {
      const d = localCenters[i].lengthSq();
      if (d < homeLen) { homeLen = d; homeIdx = i; }
    }

    const world = localCenters.map((p) => bases.localToWorld(p.clone()));
    const home = world[homeIdx];

    let secondIdx = -1, far = -1;
    for (let i = 0; i < world.length; i++) {
      if (i === homeIdx) continue;
      const d = world[i].distanceToSquared(home);
      if (d > far) { far = d; secondIdx = i; }
    }

    const sides = world.filter((_, i) => i !== homeIdx && i !== secondIdx);
    return { home, second: world[secondIdx], sides };
  }

  function calibrateFieldFromBases(field) {
    scene.add(field);
    field.updateMatrixWorld(true);

    let a = readBaseAnchors(field);
    if (!a) {
      console.warn("Base anchors not found; using fallback placement.");
      scaleToSize(field, 120);
      placeOnGround(field, new THREE.Vector3(0, 0, -38));
      return null;
    }

    // Home-to-second is 127 ft 3 3/8 in = about 38.795 m.
    const REAL_HOME_TO_SECOND = 38.795;
    const rawDist = a.home.distanceTo(a.second);
    if (rawDist > 0.001) {
      field.scale.multiplyScalar(REAL_HOME_TO_SECOND / rawDist);
      field.updateMatrixWorld(true);
    }

    a = readBaseAnchors(field);

    // Rotate so Home -> 2B points straight toward -Z.
    const dir = a.second.clone().sub(a.home);
    const currentAngle = Math.atan2(dir.x, dir.z);
    field.rotation.y += Math.PI - currentAngle;
    field.updateMatrixWorld(true);

    a = readBaseAnchors(field);

    // Put home plate at world origin.
    field.position.x -= a.home.x;
    field.position.y -= a.home.y;
    field.position.z -= a.home.z;
    field.updateMatrixWorld(true);

    a = readBaseAnchors(field);

    const forward = a.second.clone().sub(a.home);
    forward.y = 0;
    forward.normalize();

    // Sort side bases after orientation: +X = first-base side, -X = third-base side.
    const sideSorted = a.sides.slice().sort((p, q) => q.x - p.x);
    const first = sideSorted[0];
    const third = sideSorted[1];

    const thirdDir = third.clone().sub(a.home);
    thirdDir.y = 0;
    thirdDir.normalize();

    // Pitching rubber/mound center: 60 ft 6 in = 18.44 m from home.
    state.pitcherStart.copy(a.home).addScaledVector(forward, 18.44);
    state.pitcherStart.y = 0;

    // Right-handed batter stands on the third-base side of home.
    state.batterStart.copy(a.home)
      .addScaledVector(thirdDir, 1.48)
      .addScaledVector(forward, 0.10);
    state.batterStart.y = 0;

    state.pitchStart.copy(state.pitcherStart);
    state.pitchStart.y += 1.68;
    state.pitchEnd.copy(a.home);
    state.pitchEnd.y = 1.00;

    state.fieldAnchors = { home: a.home, second: a.second, first, third, forward };

    // Manual placement wins over automatic field-derived player placement.
    state.pitcherStart.copy(FINAL_PITCHER_POS);
    state.batterStart.copy(FINAL_BATTER_POS);

    // Approximate pitch path for this calibrated player scale.
    state.pitchStart.set(
      FINAL_PITCHER_POS.x,
      FINAL_PITCHER_POS.y + (1.60 * FINAL_PLAYER_SCALE),
      FINAL_PITCHER_POS.z
    );
    state.pitchEnd.set(
      FINAL_BATTER_POS.x * 0.15,
      1.00,
      0.10
    );

    console.log("Field calibrated", state.fieldAnchors);
    return state.fieldAnchors;
  }

  // Actual downloaded baseball field FBX.
  let fieldLoaded = false;
  try {
    const field = parseFBX("field");
    calibrateFieldFromBases(field);
    field.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;

      const fixFieldMaterial = (m) => {
        const n = (m && m.name ? m.name : "").toLowerCase();

        // The downloaded FBX only uses White / Dirt / Grass materials.
        // Force stable colors so FBX color-space/light settings cannot wash
        // the whole stadium into white.
        if (n.includes("grass")) {
          return new THREE.MeshBasicMaterial({
            name: m.name,
            color: 0x3f8f4d,
            side: THREE.DoubleSide
          });
        }
        if (n.includes("dirt")) {
          return new THREE.MeshBasicMaterial({
            name: m.name,
            color: 0xb78961,
            side: THREE.DoubleSide
          });
        }
        if (n.includes("white")) {
          return new THREE.MeshBasicMaterial({
            name: m.name,
            color: 0xf2f0e8,
            side: THREE.DoubleSide
          });
        }

        // Unknown materials: preserve texture, but stop pure-white blowout.
        if (m) {
          if (m.map) {
            m.map.encoding = THREE.sRGBEncoding;
            m.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          }
          if (m.color && m.color.r > 0.96 && m.color.g > 0.96 && m.color.b > 0.96) {
            m.color.setRGB(0.78, 0.78, 0.78);
          }
          if ("emissive" in m && m.emissive) m.emissive.setRGB(0, 0, 0);
          if ("emissiveIntensity" in m) m.emissiveIntensity = 0;
          m.needsUpdate = true;
        }
        return m;
      };

      if (Array.isArray(o.material)) {
        o.material = o.material.map(fixFieldMaterial);
      } else if (o.material) {
        o.material = fixFieldMaterial(o.material);
      }
    });
    if (!field.parent) scene.add(field);
    fieldLoaded = true;

    const fb = new THREE.Box3().setFromObject(field);
    const fs = new THREE.Vector3();
    fb.getSize(fs);
    console.log("Field size:", fs.x, fs.y, fs.z);
  } catch (e) {
    console.warn("Downloaded field load failed; using fallback field.", e);
  }

  // Only use the cheap generated field when the downloaded FBX fails.
  if (!fieldLoaded) {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshBasicMaterial({ color: 0x2f7d3e })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, -0.012, -35);
    scene.add(grass);

    const dirt = new THREE.Mesh(
      new THREE.CircleGeometry(24, 48),
      new THREE.MeshBasicMaterial({ color: 0x9b6845 })
    );
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.set(0, -0.006, -19.3);
    scene.add(dirt);

    const innerGrass = new THREE.Mesh(
      new THREE.CircleGeometry(14.5, 48),
      new THREE.MeshBasicMaterial({ color: 0x3f9148 })
    );
    innerGrass.rotation.x = -Math.PI / 2;
    innerGrass.position.set(0, 0, -19.3);
    scene.add(innerGrass);

    const mound = new THREE.Mesh(
      new THREE.CircleGeometry(2.7, 32),
      new THREE.MeshBasicMaterial({ color: 0xb07b52 })
    );
    mound.rotation.x = -Math.PI / 2;
    mound.position.set(0, 0.006, -18.44);
    scene.add(mound);
  }


  function setGameplayCamera() {
    camera.position.set(0, 2.35, 5.8);
    controls.target.set(0, 1.15, -13.0);
    camera.lookAt(controls.target);
    controls.update();
  }

  function makePlayer(pos, rotY) {
    const p = parseFBX("player");
    const removedJunk = stripOversizedFlatMeshes(p);
    if (removedJunk > 0) console.log("removed player junk meshes:", removedJunk);
    scalePlayerToHeight(p, 1.84);
    p.scale.multiplyScalar(FINAL_PLAYER_SCALE);
    p.userData.editorScale = FINAL_PLAYER_SCALE;
    p.rotation.y = rotY;
    p.position.copy(pos);
    p.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        if (o.material) {
          const source = Array.isArray(o.material) ? o.material : [o.material];

          const toUnlit = (m) => {
            if (m.map) {
              m.map.encoding = THREE.sRGBEncoding;
              m.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
              m.map.needsUpdate = true;
            }

            const baseColor = m.color ? m.color.clone() : new THREE.Color(0xffffff);

            return new THREE.MeshBasicMaterial({
              map: m.map || null,
              color: m.map ? 0xffffff : baseColor,
              transparent: !!m.transparent,
              opacity: m.opacity == null ? 1 : m.opacity,
              alphaTest: m.alphaTest || 0,
              side: m.side == null ? THREE.FrontSide : m.side,
              skinning: true
            });
          };

          o.material = Array.isArray(o.material)
            ? source.map(toUnlit)
            : toUnlit(source[0]);
        }
      }
    });
    if (p.userData.editorScale == null) p.userData.editorScale = FINAL_PLAYER_SCALE;
    scene.add(p);
    return p;
  }

  try {
    state.batter = makePlayer(FINAL_BATTER_POS.clone(), FINAL_BATTER_ROT_Y);
    state.pitcher = makePlayer(FINAL_PITCHER_POS.clone(), FINAL_PITCHER_ROT_Y);
  } catch (e) {
    console.error("player load failed", e);
    setStatus("선수 로드 실패: " + e.message);
    return;
  }

  setGameplayCamera();

  state.pitcherThrowHand = findBone(state.pitcher, "RightHand");
  console.log("Throw hand:", state.pitcherThrowHand ? state.pitcherThrowHand.name : "NOT FOUND");

  state.batterMixer = new THREE.AnimationMixer(state.batter);
  state.pitcherMixer = new THREE.AnimationMixer(state.pitcher);

  const batterIdleClip =
    state.batter.animations && state.batter.animations[0]
      ? state.batter.animations[0]
      : null;
  const hitR = firstClip("hitRight");
  const pitchR = firstClip("pitchRight");

  if (batterIdleClip) {
    state.batterIdle = state.batterMixer.clipAction(batterIdleClip);
    state.batterIdle.play();

    // IMPORTANT: evaluate exactly frame 0 before any equipment is attached.
    // This makes hand-bone transforms deterministic across reloads.
    state.batterIdle.time = 0;
    state.batterMixer.update(0);
    state.batter.updateMatrixWorld(true);
  }

  // Pitcher idle = first frame of Pitch Right, frozen.
  // Fielder idle is reserved for actual fielders only.
  if (hitR) {
    state.swingAction = state.batterMixer.clipAction(hitR);
    state.swingAction.setLoop(THREE.LoopOnce, 1);
    state.swingAction.clampWhenFinished = true;
  }

  if (pitchR) {
    state.pitchAction = state.pitcherMixer.clipAction(pitchR);
    state.pitchAction.setLoop(THREE.LoopOnce, 1);
    state.pitchAction.clampWhenFinished = false;
    state.pitchAction.play();
    state.pitchAction.paused = true;
    state.pitchAction.time = 0;
    state.pitcherMixer.update(0);

    state.pitcherMixer.addEventListener("finished", (e) => {
      if (e.action !== state.pitchAction) return;
      state.pitchAction.stop();
      state.pitchAction.reset();
      state.pitchAction.play();
      state.pitchAction.paused = true;
      if (state.pitching && !state.pitchReleased) {
        releaseBallFromThrowingHand();
      }

      state.pitchAction.time = 0;
      state.pitcherMixer.update(0);
      // Keep manually calibrated pitcher Y.
    });
  }

  function playOnce(action, idleAction) {
    if (!action) return;
    if (idleAction) idleAction.fadeOut(0.06);
    action.reset();
    action.setEffectiveWeight(1);
    action.fadeIn(0.05);
    action.play();

    const ms = Math.max(120, action.getClip().duration * 1000 - 70);
    setTimeout(() => {
      action.fadeOut(0.07);
      if (idleAction) {
        idleAction.reset();
        idleAction.fadeIn(0.1);
        idleAction.play();
      }
    }, ms);
  }

  // Bat
  try {
    state.bat = parseFBX("bat");
    const albedo = A.batAlbedo
      ? textureLoader.load("data:image/png;base64," + A.batAlbedo)
      : null;
    const normal = A.batNormal
      ? textureLoader.load("data:image/png;base64," + A.batNormal)
      : null;
    const metal = A.batMetalness
      ? textureLoader.load("data:image/png;base64," + A.batMetalness)
      : null;
    const rough = A.batRoughness
      ? textureLoader.load("data:image/png;base64," + A.batRoughness)
      : null;

    if (albedo) albedo.encoding = THREE.sRGBEncoding;

    state.bat.traverse((o) => {
      if (!o.isMesh) return;
      o.material = new THREE.MeshBasicMaterial({
        map: albedo,
        color: albedo ? 0xffffff : 0x9a6b3f,
        side: THREE.DoubleSide
      });
    });

    const batBone = attachProp(
      state.bat,
      state.batter,
      "RightHand",
      0.88,
      CALIBRATED_BAT_OFFSET.clone()
    );
    if (batBone) {
      state.bat.rotation.set(
        THREE.MathUtils.degToRad(CALIBRATED_BAT_ROT.x),
        THREE.MathUtils.degToRad(CALIBRATED_BAT_ROT.y),
        THREE.MathUtils.degToRad(CALIBRATED_BAT_ROT.z)
      );
      state.bat.userData.baseRotation = state.bat.rotation.clone();
      state.bat.userData.localAttachPosition = state.bat.position.clone();
      state.bat.updateMatrixWorld(true);
      console.log(
        "BAT attached:",
        batBone.name,
        "local=",
        state.bat.userData.localAttachPosition
      );
    }
  } catch (e) {
    console.warn("bat load failed", e);
  }

  // Glove
  try {
    state.glove = parseFBX("glove");
    state.glove.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const converted = mats.map((m) => new THREE.MeshBasicMaterial({
        map: m.map || null,
        color: m.map ? 0xffffff : (m.color ? m.color.clone() : new THREE.Color(0x8b5a2b)),
        transparent: !!m.transparent,
        opacity: m.opacity == null ? 1 : m.opacity,
        side: THREE.DoubleSide
      }));
      o.material = Array.isArray(o.material) ? converted : converted[0];
    });

    const gloveBone = attachProp(
      state.glove,
      state.pitcher,
      "LeftHand",
      0.31,
      CALIBRATED_GLOVE_OFFSET.clone()
    );
    if (gloveBone) {
      state.glove.rotation.set(
        THREE.MathUtils.degToRad(CALIBRATED_GLOVE_ROT.x),
        THREE.MathUtils.degToRad(CALIBRATED_GLOVE_ROT.y),
        THREE.MathUtils.degToRad(CALIBRATED_GLOVE_ROT.z)
      );
      state.glove.userData.baseRotation = state.glove.rotation.clone();
      state.glove.updateMatrixWorld(true);
      console.log("GLOVE attached:", gloveBone.name);
    }
  } catch (e) {
    console.warn("glove load failed", e);
  }

  // Lightweight gameplay ball. It is parented to the pitcher's throwing hand
  // before the pitch and released from that exact hand position.
  state.ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.037, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xf6f3e9 })
  );
  if (state.pitcherThrowHand) {
    attachBallToThrowingHand();
  } else {
    scene.add(state.ball);
    state.ball.position.copy(state.pitchStart);
  }


  function equipmentLabel(obj) {
    if (obj === state.bat) return "BAT";
    if (obj === state.glove) return "GLOVE";
    return "NONE";
  }

  function selectEquipment(obj) {
    if (!obj) {
      setStatus("장비 로드 안됨");
      return;
    }

    if (obj === state.bat && state.batterIdle && state.batterMixer) {
      state.batterIdle.paused = false;
      state.batterIdle.time = 0;
      state.batterMixer.update(0);
      state.batterIdle.paused = true;
      state.batter.updateMatrixWorld(true);

      // Re-apply the saved offset against the exact same frame used on startup.
      if (obj.userData.attachBone && obj.userData.worldOffset) {
        setBoneLocalOffsetInWorldUnits(
          obj,
          obj.userData.attachBone,
          obj.userData.worldOffset
        );
        obj.userData.localAttachPosition = obj.position.clone();
      }
    }

    state.selectedEquipment = obj;
    updateEquipmentPanel();
    setStatus(equipmentLabel(obj) + " 선택됨");
  }

  function moveEquipmentWorld(dx, dy, dz) {
    const obj = state.selectedEquipment;
    if (!obj || !obj.userData.attachBone) return;

    if (!obj.userData.worldOffset) obj.userData.worldOffset = new THREE.Vector3();
    obj.userData.worldOffset.add(new THREE.Vector3(dx, dy, dz));
    setBoneLocalOffsetInWorldUnits(
      obj,
      obj.userData.attachBone,
      obj.userData.worldOffset
    );
    updateEquipmentPanel();
  }

  function rotateEquipment(axis, degrees) {
    const obj = state.selectedEquipment;
    if (!obj) return;
    obj.rotation[axis] += THREE.MathUtils.degToRad(degrees);
    obj.updateMatrixWorld(true);
    updateEquipmentPanel();
    setStatus(equipmentLabel(obj) + " 회전 " + axis.toUpperCase());
  }

  function scaleEquipment(delta) {
    const obj = state.selectedEquipment;
    if (!obj) return;

    const oldValue = obj.userData.equipmentScale || 1;
    const newValue = Math.max(0.15, Math.min(3.0, oldValue + delta));
    const factor = newValue / oldValue;

    obj.scale.multiplyScalar(factor);
    obj.userData.equipmentScale = newValue;
    obj.updateMatrixWorld(true);
    updateEquipmentPanel();
    setStatus(equipmentLabel(obj) + " 크기 " + newValue.toFixed(2) + "x");
  }


  function resetEquipmentTransform() {
    const obj = state.selectedEquipment;
    if (!obj || !obj.userData.attachBone) return;

    obj.userData.worldOffset = obj === state.bat
      ? CALIBRATED_BAT_OFFSET.clone()
      : CALIBRATED_GLOVE_OFFSET.clone();

    setBoneLocalOffsetInWorldUnits(
      obj,
      obj.userData.attachBone,
      obj.userData.worldOffset
    );

    if (obj === state.bat) {
      obj.rotation.set(
        THREE.MathUtils.degToRad(CALIBRATED_BAT_ROT.x),
        THREE.MathUtils.degToRad(CALIBRATED_BAT_ROT.y),
        THREE.MathUtils.degToRad(CALIBRATED_BAT_ROT.z)
      );
    } else if (obj === state.glove) {
      obj.rotation.set(
        THREE.MathUtils.degToRad(CALIBRATED_GLOVE_ROT.x),
        THREE.MathUtils.degToRad(CALIBRATED_GLOVE_ROT.y),
        THREE.MathUtils.degToRad(CALIBRATED_GLOVE_ROT.z)
      );
    } else if (obj.userData.baseRotation) {
      obj.rotation.copy(obj.userData.baseRotation);
    }

    const oldValue = obj.userData.equipmentScale || 1;
    if (Math.abs(oldValue) > 0.00001) obj.scale.multiplyScalar(1 / oldValue);
    obj.userData.equipmentScale = 1.0;
    obj.updateMatrixWorld(true);

    updateEquipmentPanel();
    setStatus(equipmentLabel(obj) + " 초기화");
  }

  function copyEquipmentTransform() {
    const obj = state.selectedEquipment;
    if (!obj) return;

    const o = obj.userData.worldOffset || new THREE.Vector3();
    const r = obj.rotation;
    const text =
      equipmentLabel(obj) +
      " offset=(" +
      o.x.toFixed(3) + "," +
      o.y.toFixed(3) + "," +
      o.z.toFixed(3) + ")" +
      " rot=(" +
      THREE.MathUtils.radToDeg(r.x).toFixed(1) + "," +
      THREE.MathUtils.radToDeg(r.y).toFixed(1) + "," +
      THREE.MathUtils.radToDeg(r.z).toFixed(1) + ")" +
      " scale=" + (obj.userData.equipmentScale || 1).toFixed(3) +
      " release=" + PITCH_RELEASE_NORM.toFixed(2);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setStatus(text);
  }

  function updateEquipmentPanel() {
    const panel = document.getElementById("equipmentCoordPanel");
    if (!panel) return;

    const obj = state.selectedEquipment;
    if (!obj) {
      panel.innerHTML = "<b>장비 선택</b><br>배트 또는 글러브를 선택하세요.";
      return;
    }

    const o = obj.userData.worldOffset || new THREE.Vector3();
    const r = obj.rotation;
    panel.innerHTML =
      "<b>" + equipmentLabel(obj) + "</b><br>" +
      (obj === state.bat ? "<span style='opacity:.75'>손 기준 안정화 좌표</span><br>" : "") +
      "Offset X: " + o.x.toFixed(3) + "m<br>" +
      "Offset Y: " + o.y.toFixed(3) + "m<br>" +
      "Offset Z: " + o.z.toFixed(3) + "m<br>" +
      "Rot X: " + THREE.MathUtils.radToDeg(r.x).toFixed(1) + "°<br>" +
      "Rot Y: " + THREE.MathUtils.radToDeg(r.y).toFixed(1) + "°<br>" +
      "Rot Z: " + THREE.MathUtils.radToDeg(r.z).toFixed(1) + "°<br>" +
      "Scale: " + (obj.userData.equipmentScale || 1).toFixed(2) + "x<br>" +
      "Move: " + state.equipMoveStep.toFixed(3) + "m · " +
      "Rotate: " + state.equipRotStep.toFixed(0) + "° · " +
      "ScaleStep: " + state.equipScaleStep.toFixed(2) + "<br>" +
      "Release: " + PITCH_RELEASE_NORM.toFixed(2);
  }



  function ensureBallAttachedForEditing() {
    if (!state.ball || !state.pitcherThrowHand) return false;

    if (state.pitching || state.ballAirborne) {
      state.pitching = false;
      state.ballAirborne = false;
      state.pitchReleased = false;
      state.ballVelocity.set(0, 0, 0);
    }

    if (state.ball.parent !== state.pitcherThrowHand) {
      attachBallToThrowingHand();
    }
    return true;
  }

  function moveBallHandOffset(dx, dy, dz) {
    if (!ensureBallAttachedForEditing()) return;

    BALL_HAND_OFFSET.x += dx;
    BALL_HAND_OFFSET.y += dy;
    BALL_HAND_OFFSET.z += dz;

    setBoneLocalOffsetInWorldUnits(
      state.ball,
      state.pitcherThrowHand,
      BALL_HAND_OFFSET
    );

    updateBallSizePanel();
    setStatus(
      "BALL 위치 " +
      BALL_HAND_OFFSET.x.toFixed(3) + ", " +
      BALL_HAND_OFFSET.y.toFixed(3) + ", " +
      BALL_HAND_OFFSET.z.toFixed(3)
    );
  }

  function resetBallHandOffset() {
    BALL_HAND_OFFSET.set(-0.012, -0.176, 0.002);
    ensureBallAttachedForEditing();
    setBoneLocalOffsetInWorldUnits(
      state.ball,
      state.pitcherThrowHand,
      BALL_HAND_OFFSET
    );
    updateBallSizePanel();
    setStatus("BALL 위치 초기화");
  }

  function updateBallSizePanel() {
    const panel = document.getElementById("ballSizePanel");
    if (!panel) return;

    panel.innerHTML =
      "<b>공 크기 조정</b><br>" +
      "Scale: " + BALL_VISUAL_SCALE.toFixed(2) + "x<br>" +
      "표시 지름: " +
      (REAL_BALL_DIAMETER * BALL_VISUAL_SCALE * 100).toFixed(1) +
      "cm<br>" +
      "Offset X: " + BALL_HAND_OFFSET.x.toFixed(3) + "m<br>" +
      "Offset Y: " + BALL_HAND_OFFSET.y.toFixed(3) + "m<br>" +
      "Offset Z: " + BALL_HAND_OFFSET.z.toFixed(3) + "m<br>" +
      "크기 Step: " + state.ballScaleStep.toFixed(2) + "<br>" +
      "위치 Step: " + state.ballMoveStep.toFixed(3) + "m";
  }

  function setBallVisualScale(value) {
    BALL_VISUAL_SCALE = Math.max(0.25, Math.min(5.00, value));

    if (state.ball) {
      // Works whether the ball is attached to the hand or already in scene.
      fitAttachedWorldSize(
        state.ball,
        REAL_BALL_DIAMETER * BALL_VISUAL_SCALE
      );
    }

    updateBallSizePanel();
    setStatus("BALL 크기 " + BALL_VISUAL_SCALE.toFixed(2) + "x");
  }

  function changeBallVisualScale(delta) {
    setBallVisualScale(BALL_VISUAL_SCALE + delta);
  }

  function copyBallVisualScale() {
    const text =
      "BALL scale=" + BALL_VISUAL_SCALE.toFixed(3) +
      " diameter=" +
      (REAL_BALL_DIAMETER * BALL_VISUAL_SCALE * 100).toFixed(2) +
      "cm offset=(" +
      BALL_HAND_OFFSET.x.toFixed(3) + "," +
      BALL_HAND_OFFSET.y.toFixed(3) + "," +
      BALL_HAND_OFFSET.z.toFixed(3) + ")";

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setStatus(text);
  }

  function resetBall() {
    state.pitching = false;
    state.hit = false;
    state.ballAirborne = false;
    state.pitchReleased = false;
    state.pitchT = 0;
    state.swingWindow = 0;
    state.ballVelocity.set(0, 0, 0);

    if (state.pitcherThrowHand) {
      attachBallToThrowingHand();
    } else {
      scene.add(state.ball);
      state.ball.position.copy(state.pitchStart);
    }
  }

  function pitch() {
    if (state.pitching || state.ballAirborne) return;

    state.pitching = true;
    state.pitchReleased = false;
    state.pitchT = 0;
    state.hit = false;

    if (state.pitcherThrowHand) attachBallToThrowingHand();

    if (state.pitchAction) {
      state.pitchAction.paused = false;
      state.pitchAction.stop();
      state.pitchAction.reset();
      state.pitchAction.setLoop(THREE.LoopOnce, 1);
      state.pitchAction.clampWhenFinished = false;
      state.pitchAction.play();
    }

    setStatus("PITCH");
  }

  function swing() {
    state.swingWindow = 0.23;
    playOnce(state.swingAction, state.batterIdle);
    const swingMs = state.swingAction
      ? Math.max(140, state.swingAction.getClip().duration * 1000 + 40)
      : 200;
    // Keep manually calibrated batter Y.
    setStatus("SWING");
  }

  function hitBall() {
    state.hit = true;
    state.pitching = false;
    state.ballAirborne = true;
    const side = (Math.random() - 0.5) * 7;
    state.ballVelocity.set(
      side,
      8.2 + Math.random() * 3.8,
      -31 - Math.random() * 9
    );
    setStatus("CONTACT!");
  }

  function updateBall(dt) {
    if (state.pitching) {
      // Before release, the ball is literally a child of the throwing hand.
      if (!state.pitchReleased) {
        if (state.pitchAction) {
          const dur = Math.max(state.pitchAction.getClip().duration, 0.001);
          const norm = state.pitchAction.time / dur;

          if (norm >= PITCH_RELEASE_NORM) {
            releaseBallFromThrowingHand();
          }
        } else {
          releaseBallFromThrowingHand();
        }
      }

      // After release, use a simple ballistic flight from the actual hand point.
      if (state.pitchReleased) {
        state.pitchT += dt;
        state.ballVelocity.y -= 9.81 * dt;
        state.ball.position.addScaledVector(state.ballVelocity, dt);

        // Contact window near home plate.
        const toPlate = state.ball.position.distanceTo(state.pitchEnd);
        if (state.swingWindow > 0 && !state.hit && toPlate < 1.0) {
          const dx = Math.abs(state.ball.position.x - state.pitchEnd.x);
          const dy = Math.abs(state.ball.position.y - state.pitchEnd.y);
          if (dx < 0.65 && dy < 0.65) hitBall();
        }

        // Crossed / reached the plate without contact.
        const passedPlate = state.ball.position.z > state.pitchEnd.z + 0.35;
        if (passedPlate && !state.hit) {
          state.pitching = false;
          setStatus("MISS / TAKE");
          setTimeout(resetBall, 650);
        }
      }
    } else if (state.ballAirborne) {
      state.ballVelocity.y -= 9.81 * dt;
      state.ball.position.addScaledVector(state.ballVelocity, dt);

      if (state.ball.position.y <= 0.037) {
        state.ball.position.y = 0.037;
        state.ballVelocity.y *= -0.32;
        state.ballVelocity.x *= 0.83;
        state.ballVelocity.z *= 0.83;

        if (state.ballVelocity.length() < 2.0) {
          state.ballAirborne = false;
          setStatus("BALL IN PLAY");
          setTimeout(resetBall, 900);
        }
      }
    }
  }

  $("pitchBtn").onclick = pitch;
  $("swingBtn").onclick = swing;
  $("resetBtn").onclick = resetBall;

  addEventListener("keydown", (e) => {
    if (BALL_EDIT_MODE) {
      if (e.code === "Comma") {
        e.preventDefault();
        changeBallVisualScale(-state.ballScaleStep);
        return;
      }
      if (e.code === "Period") {
        e.preventDefault();
        changeBallVisualScale(state.ballScaleStep);
        return;
      }
    }

    if (EQUIPMENT_EDIT_MODE && state.selectedEquipment) {
      // J/L = X, I/K = Z, U/O = Y
      if (e.code === "KeyJ") { e.preventDefault(); moveEquipmentWorld(-state.equipMoveStep,0,0); return; }
      if (e.code === "KeyL") { e.preventDefault(); moveEquipmentWorld( state.equipMoveStep,0,0); return; }
      if (e.code === "KeyI") { e.preventDefault(); moveEquipmentWorld(0,0,-state.equipMoveStep); return; }
      if (e.code === "KeyK") { e.preventDefault(); moveEquipmentWorld(0,0, state.equipMoveStep); return; }
      if (e.code === "KeyU") { e.preventDefault(); moveEquipmentWorld(0,-state.equipMoveStep,0); return; }
      if (e.code === "KeyO") { e.preventDefault(); moveEquipmentWorld(0, state.equipMoveStep,0); return; }
    }

    if (POSITION_EDIT_MODE && state.selectedActor) {
      const step = getEditStep(e);

      if (e.code === "ArrowLeft") {
        e.preventDefault(); moveSelected(-step, 0, 0); return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault(); moveSelected(step, 0, 0); return;
      }
      if (e.code === "ArrowUp") {
        e.preventDefault(); moveSelected(0, 0, -step); return;
      }
      if (e.code === "ArrowDown") {
        e.preventDefault(); moveSelected(0, 0, step); return;
      }
      if (e.code === "PageUp" || e.code === "KeyE") {
        e.preventDefault(); moveSelected(0, step, 0); return;
      }
      if (e.code === "PageDown" || e.code === "KeyQ") {
        e.preventDefault(); moveSelected(0, -step, 0); return;
      }
      if (e.code === "BracketLeft" || e.code === "Minus") {
        e.preventDefault(); scaleSelected(-state.scaleStep); return;
      }
      if (e.code === "BracketRight" || e.code === "Equal") {
        e.preventDefault(); scaleSelected(state.scaleStep); return;
      }
      if (e.code === "KeyC") {
        e.preventDefault(); copySelectedCoords(); return;
      }
    }

    if (e.code === "KeyP") pitch();
    if (e.code === "Space" || e.code === "KeyS") {
      e.preventDefault();
      swing();
    }
    if (e.code === "KeyR") resetBall();
  });

  const perf = document.createElement("div");
  perf.style.fontSize = "11px";
  perf.style.opacity = "0.7";
  perf.style.marginTop = "5px";
  perf.textContent = "성능 모드";
  document.getElementById("hud").appendChild(perf);




  if (BALL_EDIT_MODE) {
    const ballEditor = document.createElement("div");
    ballEditor.id = "ballSizeEditorUI";
    ballEditor.style.marginTop = "8px";
    ballEditor.style.paddingTop = "8px";
    ballEditor.style.borderTop = "1px solid rgba(255,255,255,.18)";
    ballEditor.style.fontSize = "11px";
    ballEditor.style.lineHeight = "1.35";
    ballEditor.style.pointerEvents = "auto";
    ballEditor.style.position = "relative";
    ballEditor.style.zIndex = "9999";
    document.getElementById("hud").style.pointerEvents = "auto";
    document.getElementById("hud").appendChild(ballEditor);

    function ballButton(label, fn) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.fontSize = "10px";
      b.style.padding = "4px 6px";
      b.style.margin = "2px 2px 2px 0";
      b.style.pointerEvents = "auto";
      b.style.cursor = "pointer";
      b.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      return b;
    }

    const ballTitle = document.createElement("div");
    ballTitle.innerHTML = "<b>공 크기 조정</b>";
    ballTitle.style.marginBottom = "5px";
    ballEditor.appendChild(ballTitle);

    const ballStepRow = document.createElement("div");
    ballStepRow.appendChild(document.createTextNode("변경량 "));
    BALL_SCALE_STEPS.forEach((v) => {
      ballStepRow.appendChild(
        ballButton(v.toFixed(2), () => {
          state.ballScaleStep = v;
          updateBallSizePanel();
        })
      );
    });
    ballEditor.appendChild(ballStepRow);

    const ballControlRow = document.createElement("div");
    ballControlRow.appendChild(
      ballButton("공 작게", () => changeBallVisualScale(-state.ballScaleStep))
    );
    ballControlRow.appendChild(
      ballButton("공 크게", () => changeBallVisualScale(state.ballScaleStep))
    );
    ballControlRow.appendChild(
      ballButton("1.00x", () => setBallVisualScale(1.00))
    );
    ballEditor.appendChild(ballControlRow);

    const ballMoveStepRow = document.createElement("div");
    ballMoveStepRow.appendChild(document.createTextNode("위치 변경량 "));
    [0.005, 0.010, 0.050].forEach((v) => {
      ballMoveStepRow.appendChild(
        ballButton(v.toFixed(3), () => {
          state.ballMoveStep = v;
          updateBallSizePanel();
        })
      );
    });
    ballEditor.appendChild(ballMoveStepRow);

    const ballMoveRow = document.createElement("div");
    ballMoveRow.appendChild(ballButton("X−", () => moveBallHandOffset(-state.ballMoveStep,0,0)));
    ballMoveRow.appendChild(ballButton("X+", () => moveBallHandOffset( state.ballMoveStep,0,0)));
    ballMoveRow.appendChild(ballButton("Y−", () => moveBallHandOffset(0,-state.ballMoveStep,0)));
    ballMoveRow.appendChild(ballButton("Y+", () => moveBallHandOffset(0, state.ballMoveStep,0)));
    ballMoveRow.appendChild(ballButton("Z−", () => moveBallHandOffset(0,0,-state.ballMoveStep)));
    ballMoveRow.appendChild(ballButton("Z+", () => moveBallHandOffset(0,0, state.ballMoveStep)));
    ballEditor.appendChild(ballMoveRow);

    const ballResetRow = document.createElement("div");
    ballResetRow.appendChild(ballButton("공 위치 초기화", resetBallHandOffset));
    ballEditor.appendChild(ballResetRow);

    const ballCopyRow = document.createElement("div");
    ballCopyRow.appendChild(ballButton("공 설정 복사", copyBallVisualScale));
    ballEditor.appendChild(ballCopyRow);

    const ballPanel = document.createElement("div");
    ballPanel.id = "ballSizePanel";
    ballPanel.style.marginTop = "5px";
    ballPanel.style.padding = "5px";
    ballPanel.style.background = "rgba(255,255,255,.08)";
    ballPanel.style.borderRadius = "6px";
    ballEditor.appendChild(ballPanel);

    updateBallSizePanel();
  }

  if (EQUIPMENT_EDIT_MODE) {
    const equipEditor = document.createElement("div");
    equipEditor.id = "equipmentEditorUI";
    equipEditor.style.marginTop = "8px";
    equipEditor.style.paddingTop = "8px";
    equipEditor.style.borderTop = "1px solid rgba(255,255,255,.18)";
    equipEditor.style.fontSize = "11px";
    equipEditor.style.lineHeight = "1.35";
    equipEditor.style.pointerEvents = "auto";
    equipEditor.style.position = "relative";
    equipEditor.style.zIndex = "9999";
    document.getElementById("hud").style.pointerEvents = "auto";
    document.getElementById("hud").appendChild(equipEditor);

    const equipTitle = document.createElement("div");
    equipTitle.innerHTML = "<b>장비 조정</b>";
    equipTitle.style.marginBottom = "5px";
    equipEditor.appendChild(equipTitle);

    function equipButton(label, fn) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.fontSize = "10px";
      b.style.padding = "4px 6px";
      b.style.margin = "2px 2px 2px 0";
      b.style.pointerEvents = "auto";
      b.style.cursor = "pointer";
      b.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      return b;
    }

    const selectRow = document.createElement("div");
    selectRow.appendChild(equipButton("배트", () => selectEquipment(state.bat)));
    selectRow.appendChild(equipButton("글러브", () => selectEquipment(state.glove)));
    equipEditor.appendChild(selectRow);

    const moveStepRow = document.createElement("div");
    moveStepRow.appendChild(document.createTextNode("이동 "));
    EQUIP_MOVE_STEPS.forEach((v) => {
      moveStepRow.appendChild(
        equipButton(v.toFixed(3), () => {
          state.equipMoveStep = v;
          updateEquipmentPanel();
        })
      );
    });
    equipEditor.appendChild(moveStepRow);

    const moveRow = document.createElement("div");
    moveRow.appendChild(equipButton("X−", () => moveEquipmentWorld(-state.equipMoveStep,0,0)));
    moveRow.appendChild(equipButton("X+", () => moveEquipmentWorld( state.equipMoveStep,0,0)));
    moveRow.appendChild(equipButton("Y−", () => moveEquipmentWorld(0,-state.equipMoveStep,0)));
    moveRow.appendChild(equipButton("Y+", () => moveEquipmentWorld(0, state.equipMoveStep,0)));
    moveRow.appendChild(equipButton("Z−", () => moveEquipmentWorld(0,0,-state.equipMoveStep)));
    moveRow.appendChild(equipButton("Z+", () => moveEquipmentWorld(0,0, state.equipMoveStep)));
    equipEditor.appendChild(moveRow);

    const rotStepRow = document.createElement("div");
    rotStepRow.appendChild(document.createTextNode("회전 "));
    EQUIP_ROT_STEPS.forEach((v) => {
      rotStepRow.appendChild(
        equipButton(v + "°", () => {
          state.equipRotStep = v;
          updateEquipmentPanel();
        })
      );
    });
    equipEditor.appendChild(rotStepRow);

    const rotRow = document.createElement("div");
    rotRow.appendChild(equipButton("RX−", () => rotateEquipment("x",-state.equipRotStep)));
    rotRow.appendChild(equipButton("RX+", () => rotateEquipment("x", state.equipRotStep)));
    rotRow.appendChild(equipButton("RY−", () => rotateEquipment("y",-state.equipRotStep)));
    rotRow.appendChild(equipButton("RY+", () => rotateEquipment("y", state.equipRotStep)));
    rotRow.appendChild(equipButton("RZ−", () => rotateEquipment("z",-state.equipRotStep)));
    rotRow.appendChild(equipButton("RZ+", () => rotateEquipment("z", state.equipRotStep)));
    equipEditor.appendChild(rotRow);

    const scaleStepRow = document.createElement("div");
    scaleStepRow.appendChild(document.createTextNode("크기 "));
    EQUIP_SCALE_STEPS.forEach((v) => {
      scaleStepRow.appendChild(
        equipButton(v.toFixed(2), () => {
          state.equipScaleStep = v;
          updateEquipmentPanel();
        })
      );
    });
    equipEditor.appendChild(scaleStepRow);

    const scaleRow = document.createElement("div");
    scaleRow.appendChild(equipButton("크기−", () => scaleEquipment(-state.equipScaleStep)));
    scaleRow.appendChild(equipButton("크기+", () => scaleEquipment( state.equipScaleStep)));
    equipEditor.appendChild(scaleRow);

    const releaseRow = document.createElement("div");
    releaseRow.style.marginTop = "4px";
    releaseRow.appendChild(document.createTextNode("공 릴리스 "));
    releaseRow.appendChild(equipButton("−0.01", () => {
      PITCH_RELEASE_NORM = Math.max(0.15, PITCH_RELEASE_NORM - 0.01);
      updateEquipmentPanel();
    }));
    releaseRow.appendChild(equipButton("+0.01", () => {
      PITCH_RELEASE_NORM = Math.min(0.85, PITCH_RELEASE_NORM + 0.01);
      updateEquipmentPanel();
    }));
    equipEditor.appendChild(releaseRow);

    const copyRow = document.createElement("div");
    copyRow.appendChild(equipButton("초기화", resetEquipmentTransform));
    copyRow.appendChild(equipButton("설정 복사", copyEquipmentTransform));
    equipEditor.appendChild(copyRow);

    const equipPanel = document.createElement("div");
    equipPanel.id = "equipmentCoordPanel";
    equipPanel.style.marginTop = "5px";
    equipPanel.style.padding = "5px";
    equipPanel.style.background = "rgba(255,255,255,.08)";
    equipPanel.style.borderRadius = "6px";
    equipEditor.appendChild(equipPanel);

    selectEquipment(state.bat || state.glove);
  }

  // TEMP placement editor UI. This is intentionally button-driven as well as
  // mouse/keyboard-driven because Colab iframes can steal keyboard focus.
  if (POSITION_EDIT_MODE) {
    const editor = document.createElement("div");
    editor.id = "positionEditorUI";
    editor.style.marginTop = "8px";
    editor.style.paddingTop = "8px";
    editor.style.borderTop = "1px solid rgba(255,255,255,.18)";
    editor.style.fontSize = "12px";
    editor.style.lineHeight = "1.4";
    document.getElementById("hud").appendChild(editor);

    const title = document.createElement("div");
    title.innerHTML = "<b>선수 위치 조정</b>";
    title.style.marginBottom = "6px";
    editor.appendChild(title);

    const selectRow = document.createElement("div");
    selectRow.style.marginBottom = "6px";
    editor.appendChild(selectRow);

    function editorButton(label, fn) {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.fontSize = "11px";
      b.style.padding = "5px 7px";
      b.style.margin = "2px 3px 2px 0";
      b.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
        renderer.domElement.focus();
      };
      return b;
    }

    selectRow.appendChild(editorButton("타자 선택", () => selectActor(state.batter)));
    selectRow.appendChild(editorButton("투수 선택", () => selectActor(state.pitcher)));

    const stepRow = document.createElement("div");
    stepRow.style.marginBottom = "6px";
    editor.appendChild(stepRow);

    stepRow.appendChild(document.createTextNode("이동량 "));
    stepRow.appendChild(editorButton("0.02", () => { state.editStep = 0.02; updateCoordPanel(); }));
    stepRow.appendChild(editorButton("0.10", () => { state.editStep = 0.10; updateCoordPanel(); }));
    stepRow.appendChild(editorButton("0.50", () => { state.editStep = 0.50; updateCoordPanel(); }));

    const moveRow1 = document.createElement("div");
    const moveRow2 = document.createElement("div");
    const scaleRow = document.createElement("div");
    const scaleStepRow = document.createElement("div");
    editor.appendChild(moveRow1);
    editor.appendChild(moveRow2);
    editor.appendChild(scaleRow);
    editor.appendChild(scaleStepRow);

    moveRow1.appendChild(editorButton("X−", () => moveSelected(-state.editStep, 0, 0)));
    moveRow1.appendChild(editorButton("X+", () => moveSelected( state.editStep, 0, 0)));
    moveRow1.appendChild(editorButton("Z−", () => moveSelected(0, 0, -state.editStep)));
    moveRow1.appendChild(editorButton("Z+", () => moveSelected(0, 0,  state.editStep)));

    moveRow2.appendChild(editorButton("Y−", () => moveSelected(0, -state.editStep, 0)));
    moveRow2.appendChild(editorButton("Y+", () => moveSelected(0,  state.editStep, 0)));
    moveRow2.appendChild(editorButton("좌표 복사", copySelectedCoords));

    scaleRow.style.marginTop = "5px";
    scaleRow.appendChild(editorButton("크기−", () => scaleSelected(-state.scaleStep)));
    scaleRow.appendChild(editorButton("크기+", () => scaleSelected( state.scaleStep)));

    scaleStepRow.appendChild(document.createTextNode("크기 이동량 "));
    scaleStepRow.appendChild(editorButton("0.01", () => { state.scaleStep = 0.01; updateCoordPanel(); }));
    scaleStepRow.appendChild(editorButton("0.05", () => { state.scaleStep = 0.05; updateCoordPanel(); }));
    scaleStepRow.appendChild(editorButton("0.10", () => { state.scaleStep = 0.10; updateCoordPanel(); }));

    const coordPanel = document.createElement("div");
    coordPanel.id = "coordPanel";
    coordPanel.style.marginTop = "7px";
    coordPanel.style.padding = "6px";
    coordPanel.style.background = "rgba(255,255,255,.08)";
    coordPanel.style.borderRadius = "6px";
    editor.appendChild(coordPanel);

    updateCoordPanel();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    renderer.domElement.addEventListener("pointerdown", (e) => {
      renderer.domElement.focus();
      if (e.button !== 0) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const targets = [state.batter, state.pitcher].filter(Boolean);
      const hits = raycaster.intersectObjects(targets, true);

      if (!hits.length) return;

      let n = hits[0].object;
      while (n && n !== state.batter && n !== state.pitcher) n = n.parent;

      if (n === state.batter || n === state.pitcher) selectActor(n);
    });

    // Select batter initially so the controls work immediately.
    selectActor(state.batter);
  }

  let accumulator = 0;

  function tick() {
    requestAnimationFrame(tick);

    let dt = Math.min(clock.getDelta(), 0.1);
    accumulator += dt;
    state.fpsTime += dt;

    if (accumulator < FRAME_TIME) return;
    dt = Math.min(accumulator, 0.05);
    accumulator = 0;

    if (state.swingWindow > 0) state.swingWindow -= dt;

    // In normal gameplay the idle must keep running.
    if (!EQUIPMENT_EDIT_MODE && state.batterIdle) {
      state.batterIdle.paused = false;
    }

    if (state.batterMixer) state.batterMixer.update(dt);
    if (state.pitcherMixer) state.pitcherMixer.update(dt);
    updateBall(dt);

    controls.update();
    if (POSITION_EDIT_MODE && state.selectionHelper) state.selectionHelper.update();
    renderer.render(scene, camera);

    state.fpsFrames++;
    if (state.fpsTime >= 1) {
      perf.textContent =
        "성능 모드 · " +
        Math.round(state.fpsFrames / state.fpsTime) +
        " FPS";
      state.fpsFrames = 0;
      state.fpsTime = 0;
    }
  }

  resetBall();
  setStatus("P = 투구 / Space = 스윙");
  tick();

  addEventListener("resize", resizeRenderer);
})();
