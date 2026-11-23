(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TabataAudio=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function buildPlan(settings){
    const phases=[];
    let elapsed=0;
    const add=(phase,duration,round)=>{
      if(duration<=0)return;
      phases.push({phase,duration,round,start:elapsed,end:elapsed+duration});
      elapsed+=duration;
    };
    add('prep',settings.prep,0);
    for(let round=1;round<=settings.rounds;round++){
      add('work',settings.work,round);
      if(round<settings.rounds||settings.finalRest)add('rest',settings.rest,round);
    }
    return phases;
  }
  function phaseAt(plan,position){
    return plan.find(phase=>position<phase.end)||null;
  }
  function countdownEnabled(settings,plan,index){
    const current=plan[index],next=plan[index+1];
    if(!next||settings.countdown==='off')return false;
    if(settings.countdown==='every')return true;
    if(settings.countdown==='work')return next.phase==='work';
    return settings.countdown==='first'&&current.phase==='prep';
  }

  function createPlayer(context,buffers){
    const active=new Set();
    function connect(node,volume){
      const gain=context.createGain();
      gain.gain.value=volume;
      node.connect(gain).connect(context.destination);
      const entry={node,gain};
      active.add(entry);
      node.onended=()=>{active.delete(entry);node.disconnect();gain.disconnect();};
      return gain;
    }
    function stop(){
      for(const {node,gain} of active){
        node.onended=null;
        try{node.stop();}catch{}
        node.disconnect();gain.disconnect();
      }
      active.clear();
    }
    function sample(name,when,volume,offset=0,duration,playbackRate=1){
      const buffer=buffers[name];
      const length=Math.min(duration??buffer.duration-offset,buffer.duration-offset);
      if(length<=0)return;
      const source=context.createBufferSource();
      source.buffer=buffer;
      source.playbackRate.value=playbackRate;
      connect(source,volume);
      source.start(when,offset,length);
    }
    function tone(when,type,frequency,peak,attack,decay,tail){
      const osc=context.createOscillator(),gain=connect(osc,0);
      osc.type=type;osc.frequency.setValueAtTime(frequency,when);
      gain.gain.setValueAtTime(.0001,when);
      gain.gain.exponentialRampToValueAtTime(peak,when+attack);
      gain.gain.exponentialRampToValueAtTime(.0001,when+decay);
      osc.start(when);osc.stop(when+tail);
    }
    function transition(sound,at,position,origin){
      const cue=(delay,play)=>{
        if(at+delay>=position-.000001)play(origin+at+delay);
      };
      if(sound.startsWith('fight')){
        const count=Number(sound.slice(-1));
        for(let i=0;i<count;i++)cue(i*.34,when=>sample('bell',when,.92));
      }else if(sound==='beep'){
        [0,.24,.48].forEach((delay,i)=>cue(delay,when=>tone(when,'sine',740+i*90,.48,.012,.2,.2)));
      }else if(sound==='chime'){
        [659.25,987.77,1318.51].forEach((frequency,i)=>cue(i*.11,when=>tone(when,'sine',frequency,.3,.012,.54,.56)));
      }else if(sound==='pulse'){
        [0,.17,.34].forEach((delay,i)=>cue(delay,when=>tone(when,'square',i===2?1174.66:880,.22,.008,.12,.13)));
      }
    }
    function schedule(plan,settings,position=0){
      stop();
      // All cues are handed to the audio device now, not to background-throttled
      // animation frames, timers, or onended callbacks.
      const origin=context.currentTime+.08-position;
      plan.forEach((phase,index)=>{
        if(phase.phase!=='prep')transition(settings.sound,phase.start,position,origin);
        if(!countdownEnabled(settings,plan,index)||phase.end<=position)return;
        const start=Math.max(phase.start,phase.end-3);
        const resumeAt=Math.max(start,position);
        sample('voice',origin+resumeAt,.9,Math.max(0,3-phase.duration)+resumeAt-start,phase.end-resumeAt);
      });
      const end=plan[plan.length-1].end;
      if(end>=position){
        sample('cat',origin+end,.92,0,undefined,2**(3/12));
        sample('crowd',origin+end+1.82,.76);
      }
      return origin;
    }
    function preview(sound){stop();transition(sound,0,0,context.currentTime+.05);}
    return {schedule,stop,preview};
  }
  return {buildPlan,phaseAt,countdownEnabled,createPlayer};
});
