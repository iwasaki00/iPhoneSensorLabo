import type { CardKey, Reaction } from './cards';

/** Original Canvas artwork; animation changes only this small texture, never detector frequency. */
export function cardArt(ctx: CanvasRenderingContext2D, key: CardKey, effect?: {reaction:Reaction;progress:number}) {
  const t=effect?.progress??0, pulse=Math.sin(t*Math.PI*8), wave=effect?.reaction==='wave'?pulse:0;
  ctx.clearRect(0,0,256,256);ctx.save();
  ctx.fillStyle='#102330e8';ctx.fillRect(0,0,256,256);
  if(key==='robot'){
    ctx.strokeStyle='#65e0ff';ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(128,48);ctx.lineTo(128,23);ctx.stroke();
    ctx.fillStyle='#ffcf5c';ctx.beginPath();ctx.arc(128,22,10,0,7);ctx.fill();
    ctx.fillStyle='#65e0ff';ctx.fillRect(64,51,128,94);ctx.fillRect(81,156,94,66);ctx.fillRect(70,224,38,20);ctx.fillRect(148,224,38,20);
    ctx.fillStyle='#102330';ctx.fillRect(80,76,96,41);ctx.fillStyle='#d7fff6';ctx.fillRect(94,86,15,18);ctx.fillRect(146,86,15,18);
    ctx.strokeStyle='#65e0ff';ctx.beginPath();ctx.moveTo(77,169);ctx.lineTo(39,142-wave*22);ctx.moveTo(179,169);ctx.lineTo(217,142+wave*22);ctx.stroke();
    ctx.fillStyle='#ffcf5c';ctx.fillRect(104,174,48,24);
  } else if(key==='slime'){
    const bounce=effect?.reaction==='bounce';ctx.translate(128,230-(bounce?Math.abs(pulse)*32:0));ctx.scale(bounce?1+.12*Math.sin(t*Math.PI):1,bounce?1+.18*Math.sin(t*Math.PI):1);
    ctx.fillStyle='#8de85c';ctx.beginPath();ctx.moveTo(-92,0);ctx.bezierCurveTo(-114,-45,-45,-155,0,-165);ctx.bezierCurveTo(48,-155,113,-45,92,0);ctx.quadraticCurveTo(0,22,-92,0);ctx.fill();
    ctx.fillStyle='#142e26';for(const x of [-29,29]){ctx.beginPath();ctx.ellipse(x,-56,8,13,0,0,7);ctx.fill();}ctx.lineWidth=5;ctx.strokeStyle='#142e26';ctx.beginPath();ctx.arc(0,-42,17,0,Math.PI);ctx.stroke();
    ctx.strokeStyle='#8de85c';ctx.lineWidth=14;ctx.beginPath();ctx.moveTo(-73,-34);ctx.lineTo(-105,-59-wave*20);ctx.moveTo(73,-34);ctx.lineTo(105,-59+wave*20);ctx.stroke();
  } else {
    ctx.fillStyle='#ecf8fb';ctx.fillRect(105,37,46,18);ctx.fillRect(73,53,110,168);ctx.fillStyle='#ffd357';ctx.fillRect(83,65,90,144);ctx.fillStyle='#122f3a';ctx.beginPath();ctx.moveTo(137,81);ctx.lineTo(101,139);ctx.lineTo(126,139);ctx.lineTo(116,189);ctx.lineTo(158,124);ctx.lineTo(131,124);ctx.closePath();ctx.fill();
  }
  ctx.restore();
  if(effect){ctx.save();ctx.strokeStyle=effect.reaction==='charge'?'#ffe377':'#fff4c2';ctx.lineWidth=5;ctx.globalAlpha=.5+.5*Math.abs(pulse);ctx.strokeRect(5,5,246,246);for(let i=0;i<6;i++){const angle=i*Math.PI/3+t*8;ctx.fillStyle='#ffe377';ctx.beginPath();ctx.arc(128+105*Math.cos(angle),128+105*Math.sin(angle),5,0,7);ctx.fill();}ctx.restore();}
}
