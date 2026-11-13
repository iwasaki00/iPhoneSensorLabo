import { project } from './geometry';
export function warp(ctx:CanvasRenderingContext2D,src:HTMLCanvasElement,h:number[],w:number,height:number) {
  const n=12, point=(x:number,y:number)=>{const p=project(h,{x,y});return{x:p.x*w,y:p.y*height};};
  const triangle=(uv:{x:number;y:number}[])=>{
    const d=uv.map(p=>point(p.x,p.y)),s=uv.map(p=>({x:p.x*src.width,y:p.y*src.height}));
    const x1=s[1].x-s[0].x,y1=s[1].y-s[0].y,x2=s[2].x-s[0].x,y2=s[2].y-s[0].y,det=x1*y2-x2*y1;
    const a=((d[1].x-d[0].x)*y2-(d[2].x-d[0].x)*y1)/det,c=(x1*(d[2].x-d[0].x)-x2*(d[1].x-d[0].x))/det;
    const b=((d[1].y-d[0].y)*y2-(d[2].y-d[0].y)*y1)/det,e=(x1*(d[2].y-d[0].y)-x2*(d[1].y-d[0].y))/det;
    ctx.save();ctx.beginPath();ctx.moveTo(d[0].x,d[0].y);ctx.lineTo(d[1].x,d[1].y);ctx.lineTo(d[2].x,d[2].y);ctx.closePath();ctx.clip();ctx.transform(a,b,c,e,d[0].x-a*s[0].x-c*s[0].y,d[0].y-b*s[0].x-e*s[0].y);ctx.drawImage(src,0,0);ctx.restore();
  };
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a={x:x/n,y:y/n},b={x:(x+1)/n,y:y/n},c={x:(x+1)/n,y:(y+1)/n},d={x:x/n,y:(y+1)/n};triangle([a,b,c]);triangle([a,c,d]);}
}
