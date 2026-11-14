/** Bounded presentation raster, independently sampled from the original photo. Never upscale photos. */
export function displaySize(width:number,height:number,cssWidth:number,cssHeight:number,dpr:number){
  const density=Math.min(3,Math.max(1,dpr||1)),fit=Math.min(cssWidth/width,cssHeight/height);
  const scale=Math.min(1,fit*density,2048/Math.max(width,height),Math.sqrt(3000000/(width*height)));
  return{width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export function renderDensity(width:number,height:number,dpr:number){return Math.min(dpr||1,3,2048/Math.max(1,width,height),Math.sqrt(3000000/Math.max(1,width*height)));}
