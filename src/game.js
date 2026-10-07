
(() => {
  const A = window.ASSET_DATA;
  const $ = (id) => document.getElementById(id);

  const RENDER_SCALE = 0.90;
  const TARGET_FPS = 45;
  const FRAME_TIME = 1 / TARGET_FPS;

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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  document.body.appendChild(renderer.domElement);

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

  scene.add(new THREE.HemisphereLight(0xffffff, 0x31502c, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 0.62);
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
    pitching: false,
    pitchT: 0,
    swingWindow: 0,
    hit: false,
    ballVelocity: new THREE.Vector3(),
    ballAirborne: false,
    pitchStart: new THREE.Vector3(0, 1.68, -17.75),
    pitchEnd: new THREE.Vector3(0.12, 0.98, 0.05),
    fpsFrames: 0,
    fpsTime: 0
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

  function attachProp(prop, actor, boneName) {
    const bone = findBone(actor, boneName);
    if (!bone) {
      console.warn("bone not found:", boneName);
      return false;
    }
    bone.add(prop);
    prop.position.set(0, 0, 0);
    prop.rotation.set(0, 0, 0);
    return true;
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

  // Actual downloaded baseball field FBX.
  let fieldLoaded = false;
  try {
    const field = parseFBX("field");
    scaleToSize(field, 120);
    placeOnGround(field, new THREE.Vector3(0, 0, -38));
    field.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map) m.map.encoding = THREE.sRGBEncoding;
          m.needsUpdate = true;
        });
      }
    });
    scene.add(field);
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

  function makePlayer(pos, rotY) {
    const p = parseFBX("player");
    const removedJunk = stripOversizedFlatMeshes(p);
    if (removedJunk > 0) console.log("removed player junk meshes:", removedJunk);
    scaleToHeight(p, 1.84);
    p.rotation.y = rotY;
    placeOnGround(p, pos);
    p.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            if (m.map) {
              m.map.encoding = THREE.sRGBEncoding;
              m.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
              m.map.needsUpdate = true;
            }
            if ("metalness" in m) m.metalness = 0.0;
            if ("roughness" in m) m.roughness = Math.max(0.72, m.roughness || 0);
            m.needsUpdate = true;
          });
        }
      }
    });
    scene.add(p);
    return p;
  }

  try {
    state.batter = makePlayer(new THREE.Vector3(0.86, 0, -0.05), Math.PI);
    state.pitcher = makePlayer(new THREE.Vector3(0, 0, -18.44), 0);
  } catch (e) {
    console.error("player load failed", e);
    setStatus("선수 로드 실패: " + e.message);
    return;
  }

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
      state.pitchAction.time = 0;
      state.pitcherMixer.update(0);
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
    scaleToSize(state.bat, 0.94);

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
      o.material = new THREE.MeshStandardMaterial({
        map: albedo,
        normalMap: normal,
        metalnessMap: metal,
        roughnessMap: rough,
        metalness: metal ? 1 : 0.05,
        roughness: rough ? 1 : 0.45
      });
    });

    if (attachProp(state.bat, state.batter, "RightHand")) {
      state.bat.rotation.set(0.05, Math.PI / 2, Math.PI / 2);
      state.bat.position.set(0.03, 0.01, 0);
    }
  } catch (e) {
    console.warn("bat load failed", e);
  }

  // Glove
  try {
    state.glove = parseFBX("glove");
    scaleToSize(state.glove, 0.30);
    if (attachProp(state.glove, state.pitcher, "LeftHand")) {
      state.glove.position.set(0, 0, 0);
      state.glove.rotation.set(0, 0, 0);
    }
  } catch (e) {
    console.warn("glove load failed", e);
  }

  // Lightweight ball for prototype. The detailed FBX ball stays in the repo
  // and can be re-enabled after the core gameplay is stable.
  state.ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.037, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xf4f2e9, roughness: 0.75 })
  );
  scene.add(state.ball);

  function resetBall() {
    state.pitching = false;
    state.hit = false;
    state.ballAirborne = false;
    state.pitchT = 0;
    state.swingWindow = 0;
    state.ballVelocity.set(0, 0, 0);
    state.ball.position.copy(state.pitchStart);
  }

  function pitch() {
    if (state.pitching || state.ballAirborne) return;
    state.pitching = true;
    state.pitchT = 0;
    state.hit = false;
    if (state.pitchAction) {
      state.pitchAction.paused = false;
      state.pitchAction.stop();
      state.pitchAction.reset();
      state.pitchAction.setLoop(THREE.LoopOnce, 1);
      state.pitchAction.play();
    }
    setStatus("PITCH");
  }

  function swing() {
    state.swingWindow = 0.23;
    playOnce(state.swingAction, state.batterIdle);
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
      state.pitchT += dt;
      const releaseDelay = 0.24;
      const travel = 0.49;

      if (state.pitchT < releaseDelay) {
        state.ball.position.copy(state.pitchStart);
        return;
      }

      let t = (state.pitchT - releaseDelay) / travel;
      t = Math.min(Math.max(t, 0), 1);

      state.ball.position.lerpVectors(state.pitchStart, state.pitchEnd, t);
      state.ball.position.y += 0.13 * Math.sin(Math.PI * t) - 0.16 * t * t;

      if (state.swingWindow > 0 && !state.hit && t > 0.78 && t < 1.01) {
        const dx = Math.abs(state.ball.position.x - 0.18);
        const dy = Math.abs(state.ball.position.y - 0.98);
        if (dx < 0.55 && dy < 0.55) hitBall();
      }

      if (t >= 1 && !state.hit) {
        state.pitching = false;
        setStatus("MISS / TAKE");
        setTimeout(resetBall, 600);
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
    if (state.batterMixer) state.batterMixer.update(dt);
    if (state.pitcherMixer) state.pitcherMixer.update(dt);
    updateBall(dt);

    controls.update();
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
