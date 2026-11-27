const gradient=(a,b)=>({type:'linear',angle:90,stops:[{offset:0,color:a,opacity:1},{offset:1,color:b,opacity:1}]});
const moments='Moments',looks='Looks';
/** A key of a preset's parameter: its frame in the effect (0 is where it starts), its value and, when it is not a
 * straight line to the next key, how it gets there ('ease-in', 'ease-out', 'constant' to hold and jump). */
const key=(tick,value,interpolation)=>interpolation?{tick,value,interpolation}:{tick,value};
/** A pulse between `low` and `high`, `step` frames apart, over `length` frames. */
const pulse=(low,high,step,length)=>Array.from({length:Math.floor(length/step)+1},(_,i)=>key(i*step,i%2?high:low));
/**
 * The built-in presets: editable effects added as one effect clip (src/vfx-clips.mjs). A preset with a `duration` is a
 * moment: it starts at the playhead and lasts that many frames, with its `fadeIn` and `fadeOut` and its parameters'
 * `keys` ([effect index, parameter, keys]); one without lasts the whole animation. `target: 'scene'` offers it for
 * the scene only. The engine adds them from its own copy (engine/crates/styk-edit/src/vfx_presets.json), which
 * tests/vfx-preset-catalogue.test.mjs keeps equal to this one.
 */
export const VFX_PRESETS={
 // Moments: a short event placed at the playhead.
 'Hit flash':{icon:'lightSweep',category:moments,duration:4,fadeOut:3,effects:[['tint',{color:0xffffff,mix:1}],['glow',{color:0xffffff,radius:8,intensity:.9}]]},
 'Impact':{icon:'rgbSplit',category:moments,duration:6,fadeOut:2,effects:[['tint',{color:0xffffff,mix:.6}],['blur',{mode:1,radius:12,angle:15}],['rgbSplit',{amount:10,angle:15}]],
  keys:[[0,'mix',[key(0,.6),key(3,0)]],[1,'radius',[key(0,14,'ease-out'),key(6,0)]],[2,'amount',[key(0,12,'ease-out'),key(6,0)]]]},
 'Damage':{icon:'tint',category:moments,duration:8,effects:[['tint',{color:0xff2a2a,mix:.85}]],keys:[[0,'mix',[key(0,.85,'ease-out'),key(8,0)]]]},
 'Teleport':{icon:'dissolve',category:moments,duration:16,effects:[['dissolve',{progress:.45,size:20,color:gradient([30,240,255],[100,80,255]),edge:.14}],['glow',{color:0x49dcff,intensity:1.4,radius:10}]],
  keys:[[0,'progress',[key(0,0,'ease-in'),key(16,1)]]]},
 'Power up':{icon:'aura',category:moments,duration:36,fadeIn:3,fadeOut:8,effects:[['aura',{style:0,color:0xffc93c}],['glow',{color:0xffd25a,radius:18,intensity:1.2}]],
  keys:[[1,'intensity',pulse(.5,1.6,4,36)]]},
 'Shockwave':{icon:'shockwave',category:moments,duration:16,effects:[['shockwave',{radius:120,thickness:36,strength:28,falloff:1.2}]],
  keys:[[0,'radius',[key(0,20,'ease-out'),key(16,520)]],[0,'strength',[key(0,28),key(16,0)]]]},
 'Glitch':{icon:'pixelate',category:moments,duration:12,effects:[['rgbSplit',{amount:10}],['pixelate',{size:6}]],
  keys:[[0,'amount',[key(0,14,'constant'),key(2,3,'constant'),key(3,18,'constant'),key(5,0,'constant'),key(7,10,'constant'),key(9,2,'constant'),key(11,0)]],
   [1,'size',[key(0,1,'constant'),key(2,10,'constant'),key(3,1,'constant'),key(6,14,'constant'),key(7,1,'constant'),key(9,6,'constant'),key(10,1)]]]},
 // Combat moments: hits, dust and power, sized to land on the impact frame.
 'Punch impact':{icon:'rgbSplit',category:moments,duration:5,fadeOut:2,effects:[['tint',{color:0xffffff,mix:.35}],['blur',{mode:1,radius:8,angle:0}],['rgbSplit',{amount:6,angle:0}]],
  keys:[[0,'mix',[key(0,.35),key(3,0)]],[1,'radius',[key(0,9,'ease-out'),key(5,0)]],[2,'amount',[key(0,7,'ease-out'),key(5,0)]]]},
 'Kick impact':{icon:'rgbSplit',category:moments,duration:6,fadeOut:2,effects:[['tint',{color:0xffffff,mix:.5}],['blur',{mode:1,radius:14,angle:0}],['rgbSplit',{amount:12,angle:0}]],
  keys:[[0,'mix',[key(0,.5),key(3,0)]],[1,'radius',[key(0,15,'ease-out'),key(6,0)]],[2,'amount',[key(0,13,'ease-out'),key(6,0)]]]},
 'Heavy impact':{icon:'wave',category:moments,duration:8,fadeOut:3,effects:[['tint',{color:0xffffff,mix:.6}],['blur',{mode:1,radius:18,angle:0}],['rgbSplit',{amount:18,angle:0}],['wave',{strength:10,wavelength:90}]],
  keys:[[0,'mix',[key(0,.6),key(4,0)]],[1,'radius',[key(0,19,'ease-out'),key(8,0)]],[2,'amount',[key(0,19,'ease-out'),key(8,0)]],[3,'strength',[key(0,10,'ease-out'),key(8,0)]]]},
 'Ground slam':{icon:'wave',category:moments,duration:12,fadeOut:4,effects:[['tint',{color:0xffffff,mix:.5}],['rgbSplit',{amount:16,angle:90}],['wave',{strength:16,wavelength:140,angle:90}],['noise',{amount:.12}]],
  keys:[[0,'mix',[key(0,.5),key(5,0)]],[1,'amount',[key(0,17,'ease-out'),key(12,0)]],[2,'strength',[key(0,17,'ease-out'),key(12,0)]],[3,'amount',[key(0,.12),key(12,0)]]]},
 'Impact sparks':{icon:'particles',category:moments,duration:8,fadeOut:2,effects:[['particles',{look:1,color:0xffd25a,emission:1,count:26,life:14,size:5,speed:7,direction:0,spread:360,gravity:.4,endSize:.3,fadeIn:.05,fade:.3,stretch:3,glow:.8}]]},
 'Dust kick':{icon:'smoke',category:moments,duration:14,fadeOut:5,effects:[['smoke',{style:4,color:0x9a8f7a,emission:1,count:16,size:26,opacity:.8,rise:.8,life:30,growth:2.4,turbulence:1.2}]]},
 'Speed blur':{icon:'blur',category:moments,duration:6,fadeOut:2,effects:[['blur',{mode:1,radius:16,angle:0}],['rgbSplit',{amount:5,angle:0}]],
  keys:[[0,'radius',[key(0,16,'ease-out'),key(6,0)]],[1,'amount',[key(0,6,'ease-out'),key(6,0)]]]},
 'Power burst':{icon:'explosion',category:moments,duration:10,fadeOut:4,effects:[['explosion',{style:7,color:0x37b6ff,size:1.2,intensity:1.4,density:1.2,debris:.6,smoke:.4,sparks:1,flash:1,ring:1}],['glow',{color:0x66ccff,radius:20,intensity:1.3}]],
  keys:[[1,'intensity',[key(0,1.3,'ease-out'),key(10,0)]]]},
 'Energy charge':{icon:'aura',category:moments,duration:30,fadeIn:3,fadeOut:6,effects:[['aura',{style:1,color:0x37b6ff}],['glow',{color:0x66ccff,radius:16,intensity:1.2}]],
  keys:[[0,'intensity',[key(0,.4),key(30,1.6)]],[1,'intensity',pulse(1,1.6,5,30)]]},
 'Dark power up':{icon:'aura',category:moments,duration:32,fadeIn:3,fadeOut:6,effects:[['aura',{style:2,color:0xff3030}],['noise',{amount:.1}],['glow',{color:0xff5040,radius:18,intensity:1.4}]],
  keys:[[0,'intensity',[key(0,.5),key(32,1.8)]],[1,'amount',[key(0,.1),key(32,0)]],[2,'intensity',[key(0,1.2),key(32,2)]]]},
 'Energy blast':{icon:'beam',category:moments,duration:22,fadeIn:1,fadeOut:3,effects:[['beam',{style:0,color:0x4fd2ff,width:22,intensity:1.6,charge:8,travel:4}],['glow',{color:0x66ccff,radius:14,intensity:1.1}]]},
 'Lightning strike':{icon:'beam',category:moments,duration:14,fadeOut:4,effects:[['beam',{style:4,color:0x9fd8ff,width:14,charge:2,travel:2,arcs:5}],['tint',{color:0xffffff,mix:.5}]],
  keys:[[1,'mix',[key(0,.5),key(6,0)]]]},
 // Looks: they last the whole animation.
 'Neon':{icon:'glow',category:looks,effects:[['outline',{color:gradient([255,50,150],[70,200,255]),width:3,only:1}],['glow',{color:0xea40ff,radius:16,intensity:1.2}]]},
 'Hologram':{icon:'crt',category:looks,effects:[['tint',{color:0x31dfff,mix:.8}],['rgbSplit',{amount:2}],['noise',{amount:.08,colored:1}],['glow',{color:0x2dcfff,radius:8,intensity:.8}]]},
 'Ice':{icon:'outline',category:looks,effects:[['tint',{color:gradient([60,135,255],[210,255,255]),mix:.8}],['outline',{color:0xbaf5ff,width:2}],['lightSweep',{intensity:.7}]]},
 'Ghost':{icon:'blur',category:looks,effects:[['tint',{color:0x99bbff,mix:.75}],['blur',{radius:2}]]},
 'Golden hour':{icon:'bloom',category:looks,effects:[['grade',{temperature:.5,shadows:.15,highlights:-.1,saturation:.85}],['bloom',{threshold:.7,intensity:.6,color:gradient([255,220,150],[255,160,100])}]]},
 'Sunset':{icon:'grade',category:looks,effects:[['grade',{exposure:.05,saturation:1.2,temperature:.65,tint:.25,highlights:-.1}],['bloom',{threshold:.6,intensity:.6,radius:24,color:gradient([255,190,120],[255,120,150])}],['vignette',{amount:.35,softness:.8,color:0x3a0a20}]]},
 'Night':{icon:'vignette',category:looks,effects:[['grade',{exposure:-.7,contrast:1.1,saturation:.55,temperature:-.45,tint:.05,shadows:-.1,highlights:-.15}],['vignette',{amount:.55,softness:.7,color:0x050a1e}]]},
 'Old film':{icon:'noise',category:looks,effects:[['grade',{saturation:.3,temperature:.35,contrast:1.2,gamma:1.1}],['noise',{amount:.16,contrast:1.2,speed:1}],['vignette',{amount:.6,softness:.55,color:0x140c06}]]},
 'Retro screen':{icon:'crt',category:looks,effects:[['grade',{saturation:.65,temperature:.2}],['pixelate',{size:4}],['noise',{amount:.08}],['crt',{amount:.2,curvature:.06,chromatic:1}]]},
 // Weather and atmosphere across the whole stage: particle looks that span it from the edge they come from.
 'Rain':{icon:'particles',category:looks,target:'scene',effects:[['particles',{look:14,color:0x3d9be0,shape:3,radius:0,rate:6,life:90,size:2,speed:5,direction:-90,spread:60,gravity:.4,drag:.04,wind:.25,stretch:2,endSize:1,variation:.4,fadeIn:.02,fade:.1}]]},
 'Snow':{icon:'particles',category:looks,target:'scene',effects:[['particles',{look:13,color:0xeef6ff,shape:3,radius:0,rate:1,life:300,size:3.5,speed:3,direction:-90,spread:140,gravity:.07,drag:.05,wind:.03,turbulence:30,flow:10,spin:2,endSize:1,variation:.6,fadeIn:.05,fade:.1,outline:1,outlineColor:0x7f9bbd,outlineWidth:.8}]]},
 'Falling leaves':{icon:'particles',category:looks,target:'scene',effects:[['particles',{look:12,color:0xd9822b,shape:3,radius:0,rate:.6,life:260,size:6,speed:3,direction:-90,spread:140,gravity:.08,drag:.05,wind:.05,turbulence:40,flow:10,spin:6,endSize:1,variation:.5,fadeIn:.05,fade:.15}]]},
 'Embers':{icon:'particles',category:looks,target:'scene',effects:[['particles',{look:1,color:0xff8a2a,shape:3,radius:0,rate:4,life:110,size:5,speed:2,direction:-90,spread:40,gravity:-.05,drag:.02,flow:30,endSize:.3,variation:.6,fadeIn:.1,fade:.4,twinkle:.6,glow:.8}]]},
 // Combat looks: a fighter's power made visible, and the mood of a duel.
 'Hero aura':{icon:'aura',category:looks,effects:[['aura',{style:1,color:0x37b6ff,intensity:1.2}],['glow',{color:0x66ccff,radius:14,intensity:1}]]},
 'Villain aura':{icon:'aura',category:looks,effects:[['aura',{style:2,color:0xff3030,intensity:1.2}],['glow',{color:0xff5040,radius:14,intensity:1}]]},
 'Battle heat':{icon:'grade',category:looks,target:'scene',effects:[['grade',{temperature:.3,saturation:1.15,contrast:1.08}],['vignette',{amount:.45,color:0x1a0505}],['noise',{amount:.05}]]},
 'Midnight duel':{icon:'vignette',category:looks,target:'scene',effects:[['grade',{exposure:-.35,temperature:-.3,saturation:.9}],['vignette',{amount:.5,color:0x050a1e}],['noise',{amount:.04}]]},
};
/** Catalogue order of preset categories. */
export const PRESET_CATEGORIES=[moments,looks];
/** Default length of a newly added generated effect, in frames. */
const GENERATOR_DURATIONS={particles:48,aura:72,beam:48,explosion:36,smoke:72};
/** Whether a preset can be applied to this kind of target. */
export const presetAvailable=(preset,scene,effectAvailable)=>(!preset.target||preset.target===(scene?'scene':'figure'))&&preset.effects.every(([type])=>effectAvailable(type,scene));
/** What the engine keeps of a preset (engine/crates/styk-edit/src/vfx_presets.json): its effects, timing and keys. */
export const presetDefinition=preset=>Object.fromEntries(['effects','duration','fadeIn','fadeOut','keys'].filter(field=>preset[field]!==undefined).map(field=>[field,preset[field]]));
