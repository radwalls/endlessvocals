'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {buildPlan,phaseAt,countdownEnabled,createPlayer}=require('../tabata-audio.js');
const defaults={rounds:8,work:20,rest:10,prep:5,finalRest:false,sound:'fight3',countdown:'every'};

function harness(){
  const nodes=[];
  const parameter=()=>({value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}});
  function node(kind){
    const item={kind,gain:parameter(),frequency:parameter(),playbackRate:parameter(),stops:[],disconnects:0,
      connect(){return this;},disconnect(){this.disconnects++;},
      start(...args){this.startArgs=args;},stop(at){this.stops.push(at);}};
    nodes.push(item);return item;
  }
  const context={currentTime:100,destination:{},createGain:()=>node('gain'),createBufferSource:()=>node('sample'),createOscillator:()=>node('tone')};
  const buffers={voice:{name:'voice',duration:3.05},bell:{name:'bell',duration:1.4},cat:{name:'cat',duration:4.21},crowd:{name:'crowd',duration:7.05}};
  return {context,nodes,player:createPlayer(context,buffers),samples:()=>nodes.filter(n=>n.kind==='sample'),tones:()=>nodes.filter(n=>n.kind==='tone')};
}
function close(actual,expected){assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);}

test('default workout is an absolute 235-second timeline, with no final rest',()=>{
  const plan=buildPlan(defaults);
  assert.equal(plan.length,16);
  assert.deepEqual(plan[0],{phase:'prep',duration:5,round:0,start:0,end:5});
  assert.deepEqual(plan[15],{phase:'work',duration:20,round:8,start:215,end:235});
  plan.slice(1).forEach((phase,index)=>assert.equal(phase.start,plan[index].end));
});
test('zero prep and recovery, and optional final rest, produce the right boundaries',()=>{
  const plan=buildPlan({...defaults,rounds:2,prep:0,work:2,rest:0});
  assert.deepEqual(plan.map(p=>[p.phase,p.start,p.end]),[['work',0,2],['work',2,4]]);
  assert.equal(buildPlan({...defaults,finalRest:true}).at(-1).end,245);
});
test('phase catch-up crosses multiple missed frames without stretching the workout',()=>{
  const plan=buildPlan(defaults);
  assert.equal(phaseAt(plan,5).phase,'work');
  assert.equal(phaseAt(plan,25).phase,'rest');
  assert.equal(phaseAt(plan,219).round,8);
  assert.equal(phaseAt(plan,235),null);
  assert.equal(phaseAt(plan,999),null);
});
test('all countdown choices exclude the workout-complete boundary',()=>{
  const plan=buildPlan(defaults);
  for(const mode of ['every','work','first','off']){
    const enabled=plan.map((_,i)=>countdownEnabled({...defaults,countdown:mode},plan,i));
    assert.equal(enabled.filter(Boolean).length,{every:15,work:8,first:1,off:0}[mode]);
    assert.equal(enabled.at(-1),false);
  }
});
test('all recorded cues, including completion, are queued without any animation frames or timers',()=>{
  const h=harness(),plan=buildPlan(defaults),origin=h.player.schedule(plan,defaults);
  close(origin,100.08);
  const samples=h.samples();
  assert.equal(samples.filter(n=>n.buffer.name==='bell').length,45);
  assert.equal(samples.filter(n=>n.buffer.name==='voice').length,15);
  close(samples.find(n=>n.buffer.name==='voice').startArgs[0],102.08);
  close(samples.find(n=>n.buffer.name==='cat').startArgs[0],335.08);
  close(samples.find(n=>n.buffer.name==='crowd').startArgs[0],336.9);
  assert.ok(samples.every(n=>n.startArgs[0]>=h.context.currentTime));
});
test('pause cancels both currently playing and far-future recorded cues',()=>{
  const h=harness();h.player.schedule(buildPlan(defaults),defaults);h.player.stop();
  assert.ok(h.samples().every(n=>n.stops.length===1&&n.disconnects===1));
  assert.ok(h.nodes.filter(n=>n.kind==='gain').every(n=>n.disconnects===1));
});
test('the big-cat completion sound is raised three semitones, without pitching any other sample',()=>{
  const h=harness();h.player.schedule(buildPlan(defaults),defaults);
  close(h.samples().find(n=>n.buffer.name==='cat').playbackRate.value,2**(3/12));
  assert.ok(h.samples().filter(n=>n.buffer.name!=='cat').every(n=>n.playbackRate.value===1));
});
test('resume midway through a countdown resumes the sample offset, not a second three',()=>{
  const h=harness(),plan=buildPlan(defaults);
  h.player.schedule(plan,defaults,3.25);
  const voice=h.samples().find(n=>n.buffer.name==='voice');
  close(voice.startArgs[0],100.08);close(voice.startArgs[1],1.25);close(voice.startArgs[2],1.75);
  const bell=h.samples().find(n=>n.buffer.name==='bell');
  close(bell.startArgs[0],101.83);
});
test('resume inside work does not replay old bells and keeps future phases at their original offsets',()=>{
  const h=harness();h.player.schedule(buildPlan(defaults),defaults,17);
  const bell=h.samples().find(n=>n.buffer.name==='bell');close(bell.startArgs[0],108.08);
  const voice=h.samples().find(n=>n.buffer.name==='voice');close(voice.startArgs[0],105.08);
});
test('one- and two-second intervals skip the missing countdown numbers and trim at the boundary',()=>{
  for(const duration of [1,2]){
    const h=harness(),settings={...defaults,rounds:2,prep:0,work:duration,rest:0};
    h.player.schedule(buildPlan(settings),settings);
    const voice=h.samples().find(n=>n.buffer.name==='voice');
    close(voice.startArgs[0],100.08);close(voice.startArgs[1],3-duration);close(voice.startArgs[2],duration);
  }
});
test('each fight-bell choice schedules its own exact number of device-timed strikes',()=>{
  for(const count of [1,2,3]){
    const h=harness();h.player.preview('fight'+count);
    assert.equal(h.samples().length,count);
    h.samples().forEach((n,i)=>close(n.startArgs[0],100.05+i*.34));
  }
});
test('every synthesized sound is pre-scheduled and fully cancellable',()=>{
  for(const sound of ['beep','chime','pulse']){
    const h=harness(),settings={...defaults,sound,countdown:'off'};
    h.player.schedule(buildPlan(settings),settings);
    assert.equal(h.tones().length,45);
    assert.equal(h.samples().length,2);
    h.player.stop();assert.ok(h.tones().every(n=>n.stops.length===2&&n.disconnects===1));
  }
});
test('silent transition mode leaves voice and completion effects intact',()=>{
  const h=harness();h.player.schedule(buildPlan(defaults),{...defaults,sound:'silent'});
  assert.equal(h.tones().length,0);
  assert.equal(h.samples().filter(n=>n.buffer.name==='bell').length,0);
  assert.equal(h.samples().length,17);
});
test('rescheduling replaces rather than duplicates the old workout',()=>{
  const h=harness(),plan=buildPlan(defaults);h.player.schedule(plan,defaults);
  const first=h.samples().slice();h.context.currentTime=150;h.player.schedule(plan,defaults,10);
  assert.ok(first.every(n=>n.stops.length===1));
  assert.ok(h.samples().slice(first.length).every(n=>n.startArgs[0]>=150));
});
test('ended nodes release their connections and are not stopped twice',()=>{
  const h=harness();h.player.preview('fight1');const sample=h.samples()[0];
  sample.onended();h.player.stop();assert.equal(sample.disconnects,1);assert.equal(sample.stops.length,0);
});
test('long intervals and maximum rounds are also scheduled all the way to completion',()=>{
  const h=harness(),settings={...defaults,rounds:99,work:900,rest:600,prep:600,finalRest:true};
  const plan=buildPlan(settings);assert.equal(plan.at(-1).end,149100);
  h.player.schedule(plan,settings);
  close(h.samples().find(n=>n.buffer.name==='cat').startArgs[0],149200.08);
});

function appHarness(fetchOverride){
  const h=harness(),html=fs.readFileSync(require.resolve('../tabata.html'),'utf8');
  const elements=new Map(),listeners=new Map(),frames=new Map();let frameId=0;
  function element(attributes={}){
    const classes=new Set();
    return {attributes,children:[],options:[],style:{setProperty(){}},value:attributes.value||'',min:attributes.min,max:attributes.max,
      textContent:'',disabled:false,handlers:{},classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));},toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains(name){return classes.has(name);}},
      setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name];},
      append(child){this.children.push(child);},add(option){this.options.push(option);},querySelector(){return null;},focus(){},
      addEventListener(name,callback){this.handlers[name]=callback;}};
  }
  for(const tag of html.matchAll(/<[^>]+\bid="[^"]+"[^>]*>/g)){
    const attributes=Object.fromEntries([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    elements.set(attributes.id,element(attributes));
  }
  const document={hidden:false,documentElement:element(),getElementById:id=>elements.get(id),createElement:()=>element(),addEventListener:(name,callback)=>listeners.set(name,callback)};
  h.context.state='running';h.context.resume=async()=>{};
  h.context.decodeAudioData=async name=>({name,duration:name==='voice'?3.05:7});
  const names={'sounds/male-countdown.wav':'voice','sounds/fight-bell.wav':'bell','sounds/big-cat-growl.wav':'cat','sounds/crowd-cheer.wav':'crowd'};
  const sandbox={document,TabataAudio:require('../tabata-audio.js'),localStorage:{getItem(){return null;},setItem(){}},Option:function(label,value){return {label,value};},
    window:{AudioContext:function(){return h.context;},setTimeout(){return 1;},clearTimeout(){}},
    requestAnimationFrame(callback){const id=++frameId;frames.set(id,callback);return id;},cancelAnimationFrame(id){frames.delete(id);},
    fetch:fetchOverride|| (async url=>({ok:true,arrayBuffer:async()=>names[url]}))};
  const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInNewContext(inline,sandbox);
  return {...h,elements,listeners,frames,click:id=>elements.get(id).handlers.click()};
}
test('the actual page catches up after animation frames stop, without replaying audio',async()=>{
  const h=appHarness();await h.click('start');
  const sources=h.samples().length;
  // Simulate a hidden tab: advance the audio device, never invoke the RAF callbacks.
  h.context.currentTime=188.08;
  h.listeners.get('visibilitychange')();
  assert.equal(h.elements.get('roundCount').textContent,'3/8');
  assert.equal(h.elements.get('clock').textContent,'00:07');
  assert.equal(h.samples().length,sources);
  h.context.currentTime=400;
  h.listeners.get('visibilitychange')();
  assert.equal(h.elements.get('roundCount').textContent,'8/8');
  assert.equal(h.elements.get('clock').textContent,'00:00');
  assert.ok(h.elements.get('finish').classList.contains('show'));
  assert.equal(h.samples().length,sources);
});
test('the actual page pauses at the precise audio position and resumes from there',async()=>{
  const h=appHarness();await h.click('start');h.context.currentTime=108.33;
  await h.click('start');assert.equal(h.elements.get('clock').textContent,'00:17');
  const before=h.samples().length;h.context.currentTime=200;
  await h.click('start');const next=h.samples().slice(before).find(n=>n.buffer.name==='bell');
  close(next.startArgs[0],216.83);
  await h.click('reset');assert.equal(h.elements.get('clock').textContent,'00:00');
  assert.ok(h.samples().every(n=>n.stops.length===1));
});
test('a failed sound download leaves the timer stopped and exposes a retry message',async()=>{
  const h=appHarness(async()=>({ok:false}));await h.click('start');
  assert.equal(h.elements.get('start').textContent,'Start');
  assert.equal(h.elements.get('start').disabled,false);
  assert.match(h.elements.get('audioStatus').textContent,/press Start to retry/i);
  assert.equal(h.samples().length,0);
  assert.equal(h.frames.size,0);
});
test('Reset during sound loading prevents the pending Start from launching later',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});
  const h=appHarness(async()=>{await held;return {ok:true,arrayBuffer:async()=>'voice'};});
  const starting=h.click('start');assert.equal(h.elements.get('start').disabled,true);
  await h.click('reset');release();await starting;
  assert.equal(h.elements.get('start').textContent,'Start');
  assert.equal(h.elements.get('clock').textContent,'00:00');
  assert.equal(h.samples().length,0);
  assert.equal(h.frames.size,0);
});
