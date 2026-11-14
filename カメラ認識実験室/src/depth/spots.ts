import type { DepthMap } from './processing';
import { visibility, type HideVisibility } from './hide.ts';

export type HidePose={x:number;y:number;depth:number};
export type HideSpot=HidePose&{score:number;ratio:number;cohesion:number};
export const SPOT_LIMITS={trials:480,finalists:16,results:3} as const;
export function spotScore(q:HideVisibility,headFraction=0){
  return 3*q.largest/Math.max(1,q.visible)+Math.min(1,headFraction)*.4-Math.abs(q.ratio-.35);
}
/** Distances use source pixels, never CSS/mirrored coordinates. */
export function distinctSpots(spots:HideSpot[],width:number,height:number,limit:number,separation=.65){
  const selected:HideSpot[]=[];const distance=Math.min(width,height)*.35*separation;
  for(const spot of [...spots].sort((a,b)=>b.score-a.score))if(selected.every(p=>Math.hypot((p.x-spot.x)*width,(p.y-spot.y)*height)>=distance)){
    selected.push(spot);if(selected.length===limit)break;
  }
  return selected;
}
/** Bounded coarse search. Thumbnail coordinates are source-aligned. No model or photo-specific rules. */
export async function coarseSpots(map:DepthMap,art:Uint8ClampedArray,artSize:number,cssScale:number,current:()=>boolean,yieldUI:()=>Promise<void>){
  const {width:w,height:h}=map,size=Math.min(w,h)*.35,span=map.maximum-map.minimum;
  const spots:HideSpot[]=[];let trials=0;
  if(!(span>0))return{spots,trials};
  // Local thresholds are tested only where foreground/background depth varies across the robot footprint.
  for(let gy=0;gy<13;gy++)for(let gx=0;gx<13;gx++){
    if(!current()||trials>=SPOT_LIMITS.trials)return{spots:current()?distinctSpots(spots,w,h,SPOT_LIMITS.finalists,.28):[],trials};
    const x=size/2+(w-size)*gx/12,y=size/2+(h-size)*gy/12,left=x-size/2,top=y-size/2;
    const body=new Uint8ClampedArray(w*h),samples:number[]=[];
    for(let yy=Math.ceil(top);yy<top+size&&yy<h;yy++)for(let xx=Math.ceil(left);xx<left+size&&xx<w;xx++){
      const ax=Math.min(artSize-1,Math.floor((xx-left)/size*artSize)),ay=Math.min(artSize-1,Math.floor((yy-top)/size*artSize));
      if(art[ay*artSize+ax]>=128){const i=yy*w+xx;body[i]=255;samples.push((map.values[i]-map.minimum)/span);}
    }
    samples.sort((a,b)=>a-b);if(!samples.length||samples[Math.floor(samples.length*.9)]-samples[Math.floor(samples.length*.1)]<.06)continue;
    for(const quantile of [.28,.5,.7]){
      if(trials>=SPOT_LIMITS.trials)break;
      const depth=Math.max(0,Math.min(100,Math.round(100*(1-samples[Math.floor((samples.length-1)*quantile)])))),near=1-depth/100;
      const visible=Uint8ClampedArray.from(body,(a,i)=>a&&(map.values[i]-map.minimum)/span<=near?255:0);
      const q=visibility(body,visible,w,h,cssScale,true);trials++;
      if(q.ready&&q.largest/Math.max(1,q.visible)>=.6)spots.push({x:x/w,y:y/h,depth,ratio:q.ratio,cohesion:q.largest/q.visible,score:spotScore(q)});
      if(trials%18===0){await yieldUI();if(!current())return{spots:[],trials};}
    }
  }
  return{spots:distinctSpots(spots,w,h,SPOT_LIMITS.finalists,.28),trials};
}
