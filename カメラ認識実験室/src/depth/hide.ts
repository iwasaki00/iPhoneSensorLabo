/** Geometry only: no inference, storage, or image upload. Coordinates are source-photo pixels. */
export type HideVisibility = { ratio:number; visible:number; largest:number; spanX:number; spanY:number; ready:boolean; reason:string; label:string };
export function visibility(body:Uint8ClampedArray,visible:Uint8ClampedArray,width:number,height:number,scale:number,inBounds:boolean):HideVisibility {
  let total=0,count=0;for(let i=0;i<body.length;i++){if(body[i]>=128)total++;if(body[i]>=128&&visible[i]>=128)count++;}
  const ratio=total?count/total:0,seen=new Uint8Array(body.length),queue=new Int32Array(count);let largest=0,spanX=0,spanY=0;
  for(let i=0;i<body.length;i++)if(body[i]>=128&&visible[i]>=128&&!seen[i]){
    let head=0,tail=1,minX=i%width,maxX=minX,minY=Math.floor(i/width),maxY=minY;queue[0]=i;seen[i]=1;
    while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const n of [x>0?p-1:-1,x<width-1?p+1:-1,y>0?p-width:-1,y<height-1?p+width:-1])if(n>=0&&!seen[n]&&body[n]>=128&&visible[n]>=128){seen[n]=1;queue[tail++]=n;}
    }
    if(tail>largest){largest=tail;spanX=(maxX-minX+1)*scale;spanY=(maxY-minY+1)*scale;}
  }
  const reason=!inBounds?'ロボット全体を写真の中に入れてください。':ratio>.65?'見えすぎです。奥行きや場所を調整してください。':ratio<.12?'隠れすぎです。もう少し見えるようにしてください。':largest*scale*scale<36||spanX<6||spanY<6?'見える部分が画面上で小さすぎます。場所を調整してください。':'';
  return{ratio,visible:count,largest,spanX,spanY,ready:!reason,label:ratio>.65?'見えすぎ':ratio<.12?'隠れすぎ':'ちょうどいい',reason};
}
/** Circular CSS-pixel tolerance around visible body only, never the hidden bounding rectangle. */
export function visibleHit(body:Uint8ClampedArray,visible:Uint8ClampedArray,width:number,height:number,x:number,y:number,radius:number){
  const r=Math.max(0,radius);for(let yy=Math.max(0,Math.floor(y-r));yy<=Math.min(height-1,Math.ceil(y+r));yy++)for(let xx=Math.max(0,Math.floor(x-r));xx<=Math.min(width-1,Math.ceil(x+r));xx++)if((xx-x)**2+(yy-y)**2<=r*r&&body[yy*width+xx]>=128&&visible[yy*width+xx]>=128)return true;return false;
}
