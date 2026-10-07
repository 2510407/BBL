
(() => {
  const A = window.ASSET_DATA;
  const $ = (id) => document.getElementById(id);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ec9e8);

  const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.05, 1000);
  camera.position.set(0, 2.4, 5.5);
  camera.lookAt(0, 1.25, -10);

  const renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x415163, 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(10, 18, 8);
  sun.castShadow = true;
  scene.add(sun);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, -7);
  controls.enableDamping = true;

  const loader = new THREE.FBXLoader();
  const textureLoader = new THREE.TextureLoader();
  const clock = new THREE.Clock();

  const state = {
    batter:null, pitcher:null, bat:null, glove:null, ball:null,
    batterMixer:null, pitcherMixer:null,
    batterIdle:null, pitcherIdle:null, swingAction:null, pitchAction:null,
    pitching:false, pitchT:0, swingWindow:0, hit:false,
    ballVelocity:new THREE.Vector3(), ballAirborne:false,
    pitchStart:new THREE.Vector3(0, 1.72, -18.44),
    pitchEnd:new THREE.Vector3(0, 1.02, 0.05),
  };

  function b64ToBuffer(b64){
    const raw = atob(b64), a = new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) a[i] = raw.charCodeAt(i);
    return a.buffer;
  }
  function parseFBX(key){
    if(!A[key]) throw new Error("missing asset: " + key);
    return loader.parse(b64ToBuffer(A[key]), "");
  }
  function scaleToHeight(obj, h){
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    if(size.y > 0){
      const s = h/size.y;
      obj.scale.multiplyScalar(s);
    }
  }
  function scaleToSize(obj, maxSize){
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const m = Math.max(size.x,size.y,size.z);
    if(m > 0) obj.scale.multiplyScalar(maxSize/m);
  }
  function groundObject(obj){
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.y -= box.min.y;
  }
  function firstClip(key){
    try{
      const f = parseFBX(key);
      return (f.animations && f.animations[0]) ? f.animations[0] : null;
    }catch(e){ console.warn(e); return null; }
  }
  function findBone(obj, words){
    let found=null;
    obj.traverse(o=>{
      if(found || !o.isBone) return;
      const n=(o.name||"").toLowerCase().replace(/[^a-z]/g,"");
      if(words.every(w=>n.includes(w))) found=o;
    });
    return found;
  }
  function attachProp(prop, actor, handWords, scale=1){
    const hand = findBone(actor, handWords);
    if(!hand){ actor.add(prop); prop.position.set(0,1,0); return; }
    hand.add(prop);
    prop.position.set(0,0,0);
    prop.rotation.set(0,0,0);
    prop.scale.multiplyScalar(scale);
  }
  function setStatus(t){ $("status").textContent=t; }

  // fallback floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(140,140),
    new THREE.MeshStandardMaterial({color:0x4d8d47, roughness:1})
  );
  floor.rotation.x = -Math.PI/2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  scene.add(floor);

  // Field
  try{
    const field = parseFBX("field");
    scaleToSize(field, 120);
    groundObject(field);
    field.position.set(0,0,-38);
    field.traverse(o=>{ if(o.isMesh){o.receiveShadow=true; o.castShadow=true;} });
    scene.add(field);
  }catch(e){ console.warn("Field load failed",e); }

  function makePlayer(pos, rotY){
    const p = parseFBX("player");
    scaleToHeight(p, 1.84);
    groundObject(p);
    p.position.copy(pos);
    p.rotation.y = rotY;
    p.traverse(o=>{ if(o.isMesh){o.castShadow=true; o.receiveShadow=true;} });
    scene.add(p);
    return p;
  }

  state.batter = makePlayer(new THREE.Vector3(0.75,0,0.2), Math.PI);
  state.pitcher = makePlayer(new THREE.Vector3(0,0,-18.44), 0);

  state.batterMixer = new THREE.AnimationMixer(state.batter);
  state.pitcherMixer = new THREE.AnimationMixer(state.pitcher);

  const idleR = firstClip("idleRight");
  const fielderIdle = firstClip("fielderIdle");
  const hitR = firstClip("hitRight");
  const pitchR = firstClip("pitchRight");

  if(idleR){
    state.batterIdle = state.batterMixer.clipAction(idleR);
    state.batterIdle.play();
  }
  if(fielderIdle){
    state.pitcherIdle = state.pitcherMixer.clipAction(fielderIdle);
    state.pitcherIdle.play();
  }
  if(hitR){
    state.swingAction = state.batterMixer.clipAction(hitR);
    state.swingAction.setLoop(THREE.LoopOnce,1);
    state.swingAction.clampWhenFinished=true;
  }
  if(pitchR){
    state.pitchAction = state.pitcherMixer.clipAction(pitchR);
    state.pitchAction.setLoop(THREE.LoopOnce,1);
    state.pitchAction.clampWhenFinished=true;
  }

  // Bat
  try{
    state.bat = parseFBX("bat");
    scaleToSize(state.bat, 1.0);
    state.bat.traverse(o=>{
      if(!o.isMesh) return;
      const albedo = A.batAlbedo ? textureLoader.load("data:image/png;base64,"+A.batAlbedo) : null;
      const normal = A.batNormal ? textureLoader.load("data:image/png;base64,"+A.batNormal) : null;
      const metal = A.batMetalness ? textureLoader.load("data:image/png;base64,"+A.batMetalness) : null;
      const rough = A.batRoughness ? textureLoader.load("data:image/png;base64,"+A.batRoughness) : null;
      const mat = new THREE.MeshStandardMaterial({map:albedo, normalMap:normal, metalnessMap:metal, roughnessMap:rough});
      o.material=mat; o.castShadow=true;
    });
    attachProp(state.bat, state.batter, ["righthand"], 0.9);
    state.bat.rotation.set(0, Math.PI/2, Math.PI/2);
    state.bat.position.set(0.05,0.02,0);
  }catch(e){ console.warn("Bat load failed",e); }

  // Glove
  try{
    state.glove = parseFBX("glove");
    scaleToSize(state.glove, 0.32);
    attachProp(state.glove, state.pitcher, ["lefthand"], 1);
    state.glove.rotation.set(0,0,0);
    state.glove.position.set(0,0,0);
  }catch(e){ console.warn("Glove load failed",e); }

  // Ball
  try{
    state.ball = parseFBX("ball");
    scaleToSize(state.ball, 0.074);
  }catch(e){
    state.ball = new THREE.Mesh(new THREE.SphereGeometry(0.037,20,20), new THREE.MeshStandardMaterial({color:0xffffff}));
  }
  state.ball.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  scene.add(state.ball);
  state.ball.position.copy(state.pitchStart);

  function resetBall(){
    state.pitching=false; state.hit=false; state.ballAirborne=false;
    state.pitchT=0; state.swingWindow=0;
    state.ballVelocity.set(0,0,0);
    state.ball.position.copy(state.pitchStart);
  }

  function pitch(){
    if(state.pitching || state.ballAirborne) return;
    state.pitching=true; state.pitchT=0; state.hit=false;
    if(state.pitchAction){
      state.pitchAction.reset().fadeIn(0.05).play();
    }
    setStatus("PITCH");
  }

  function swing(){
    state.swingWindow=0.28;
    if(state.swingAction){
      state.swingAction.reset().fadeIn(0.03).play();
    }
    setStatus("SWING");
  }

  function hitBall(){
    state.hit=true; state.pitching=false; state.ballAirborne=true;
    // Toward center field (-Z), slightly randomized horizontal direction.
    const side = (Math.random()-0.5)*5.5;
    state.ballVelocity.set(side, 8.5 + Math.random()*3.0, -31 - Math.random()*8);
    setStatus("CONTACT!");
  }

  function updateBall(dt){
    if(state.pitching){
      state.pitchT += dt;
      // release delay + ~0.62 sec travel
      const releaseDelay=0.28, travel=0.62;
      if(state.pitchT < releaseDelay){
        state.ball.position.copy(state.pitchStart);
        return;
      }
      let t=(state.pitchT-releaseDelay)/travel;
      t=Math.min(Math.max(t,0),1);

      // Simple fastball with slight drop
      state.ball.position.lerpVectors(state.pitchStart,state.pitchEnd,t);
      state.ball.position.y += 0.22*Math.sin(Math.PI*t) - 0.18*t*t;

      if(state.swingWindow>0 && !state.hit && t>0.78 && t<1.03){
        // prototype contact window
        const dx=Math.abs(state.ball.position.x-0.25);
        const dy=Math.abs(state.ball.position.y-1.02);
        if(dx<0.6 && dy<0.65) hitBall();
      }

      if(t>=1 && !state.hit){
        state.pitching=false;
        setStatus("MISS / TAKE");
        setTimeout(resetBall,700);
      }
    } else if(state.ballAirborne){
      state.ballVelocity.y -= 9.81*dt;
      state.ball.position.addScaledVector(state.ballVelocity,dt);
      if(state.ball.position.y<=0.037){
        state.ball.position.y=0.037;
        state.ballVelocity.y *= -0.34;
        state.ballVelocity.x *= 0.82;
        state.ballVelocity.z *= 0.82;
        if(state.ballVelocity.length()<2.2){
          state.ballAirborne=false;
          setStatus("BALL IN PLAY");
          setTimeout(resetBall,1100);
        }
      }
    }
  }

  $("pitchBtn").onclick=pitch;
  $("swingBtn").onclick=swing;
  $("resetBtn").onclick=resetBall;
  addEventListener("keydown",e=>{
    if(e.code==="KeyP") pitch();
    if(e.code==="Space" || e.code==="KeyS"){ e.preventDefault(); swing(); }
    if(e.code==="KeyR") resetBall();
  });

  function tick(){
    requestAnimationFrame(tick);
    const dt=Math.min(clock.getDelta(),0.033);
    if(state.swingWindow>0) state.swingWindow-=dt;
    if(state.batterMixer) state.batterMixer.update(dt);
    if(state.pitcherMixer) state.pitcherMixer.update(dt);
    updateBall(dt);
    controls.update();
    renderer.render(scene,camera);
  }
  resetBall();
  setStatus("P = 투구 / Space = 스윙");
  tick();

  addEventListener("resize",()=>{
    camera.aspect=innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight);
  });
})();
