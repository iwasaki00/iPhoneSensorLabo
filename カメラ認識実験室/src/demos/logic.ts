import {PixelProcessor,type PixelFrame} from '../modes/pixels.ts';
import {defaults} from '../settings.ts';
import type {Box} from '../core.ts';
/** Shared by spot-the-difference and bench checking. RGB difference is fed through the existing motion components. */
export function comparePhotos(before:PixelFrame,after:PixelFrame){
  if(before.width!==after.width||before.height!==after.height)throw Error('写真の縦横比・大きさをそろえて撮り直してください。');
  const data=new Uint8ClampedArray(before.data.length);
  for(let i=0;i<data.length;i+=4){const d=Math.max(...[0,1,2].map(c=>Math.abs(before.data[i+c]-after.data[i+c])));data[i]=data[i+1]=data[i+2]=d;data[i+3]=255;}
  const processor=new PixelProcessor('motion'),settings={...defaults,minArea:30,motionSensitivity:65};
  processor.process({data:new Uint8ClampedArray(data.length),width:before.width,height:before.height},settings,1);
  const result=processor.process({width:before.width,height:before.height,data},settings,2);processor.dispose();
  const ratio=result.mask.reduce((sum,v)=>sum+Number(v>0),0)/result.mask.length;
  const boxes=result.regions.filter(r=>r.box.width>=5&&r.box.height>=5).map(r=>r.box);
  const reason=ratio<.001||!boxes.length?'差が小さく、場所を絞れません。物を1つ大きめに動かして撮り直してください。':ratio>.35?'画面全体が変わっています。カメラの位置・照明を固定し、手を外して撮り直してください。':'';
  return{...result,boxes,ratio,reason};
}
export function slotChanged(mask:Uint8Array,width:number,height:number,box:Box){
  let hit=0,total=0;for(let y=Math.max(0,Math.floor(box.y));y<Math.min(height,Math.ceil(box.y+box.height));y++)for(let x=Math.max(0,Math.floor(box.x));x<Math.min(width,Math.ceil(box.x+box.width));x++){total++;hit+=Number(mask[y*width+x]>0);}
  return{ratio:total?hit/total:0,changed:total>0&&hit/total>.06};
}
export function hitBox(box:Box,x:number,y:number,tolerance:number){return x>=box.x-tolerance&&x<=box.x+box.width+tolerance&&y>=box.y-tolerance&&y<=box.y+box.height+tolerance;}
export function maskIntersection(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)throw Error('同じフレームのマスクを使ってください。');return Uint8Array.from(a,(v,i)=>v&&b[i]?1:0);}
/** One invocation per analyzed frame. Seeing a cup far away is mandatory before approaching. */
export class WorkshopTrigger {
  armed=false;fired=false;private nearCount=0;private last=-1;
  update(frame:number,distance:number|null){if(frame===this.last)return false;this.last=frame;if(this.fired)return false;if(distance===null){this.nearCount=0;return false;}
    if(distance>.34){this.armed=true;this.nearCount=0;}
    else if(this.armed&&distance<.24){if(++this.nearCount>=2){this.fired=true;return true;}}else this.nearCount=0;return false;
  }
}
