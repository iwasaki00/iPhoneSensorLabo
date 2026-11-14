// Explicit developer action. No network, inference, user images or runtime answer metadata.
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const out=new URL('../public/demo-samples/',import.meta.url);await mkdir(out,{recursive:true});
const coffee=(await readFile(new URL('../public/samples/coffee.png',import.meta.url))).toString('base64');
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
const temporary=await mkdtemp(path.join(tmpdir(),'camera-demo-frames-'));
try{
  await page.evaluate(async coffee=>{const image=new Image();image.src='data:image/png;base64,'+coffee;await image.decode();window.coffee=image;},coffee);
  const stills=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=640;c.height=420;const x=c.getContext('2d'),images={};
    const desk=()=>{x.fillStyle='#bda889';x.fillRect(0,0,640,420);for(let i=0;i<420;i+=26){x.strokeStyle='#b29c7d';x.beginPath();x.moveTo(0,i);x.lineTo(640,i);x.stroke();}};
    const object=(px,py,color)=>{x.fillStyle=color;x.fillRect(px,py,90,70);x.strokeStyle='#26353a';x.lineWidth=4;x.strokeRect(px,py,90,70);};
    for(const type of ['before','moved','missing']){desk();object(70,100,'#c92c35');object(420,260,'#e8e9d1');if(type!=='missing')object(type==='moved'?300:260,type==='moved'?280:105,'#235fbd');images['desk-'+type+'.png']=c.toDataURL().split(',')[1];}
    x.fillStyle='#eeeade';x.fillRect(0,0,640,420);x.fillStyle='#d12235';x.fillRect(190,130,200,150);images['red.png']=c.toDataURL().split(',')[1];
    x.fillStyle='#eeeade';x.fillRect(0,0,640,420);x.fillStyle='#24292f';x.beginPath();x.arc(320,210,95,0,Math.PI*2);x.fill();images['round.png']=c.toDataURL().split(',')[1];
    x.fillStyle='#c6c9c8';x.fillRect(0,0,640,420);x.fillStyle='#fafafa';x.fillRect(45,45,550,130);x.strokeStyle='#333';x.strokeRect(45,45,550,130);x.fillStyle='#111';x.font='bold 44px Arial';x.fillText('PUMP A-12',70,125);x.fillStyle='#17252b';x.fillRect(45,205,550,145);x.fillStyle='white';x.font='bold 54px Arial';x.fillText('-12.50 kPa',68,298);x.font='18px Arial';x.fillStyle='#222';x.fillText('FICTIONAL TRAINING PANEL',55,390);images['panel.png']=c.toDataURL().split(',')[1];return images;
  });
  for(const [name,data]of Object.entries(stills))await writeFile(new URL(name,out),Buffer.from(data,'base64'));
  for(const kind of ['workshop','blue']){
    const dir=path.join(temporary,kind);await mkdir(dir);
    // 8 seconds at 12 fps. Still holds at both ends allow real model startup and distant/near observations.
    for(let i=0;i<96;i++){
      const data=await page.evaluate(({kind,i})=>{const c=document.createElement('canvas');c.width=640;c.height=420;const x=c.getContext('2d');x.fillStyle='#c8bea9';x.fillRect(0,0,640,420);
        if(kind==='workshop'){x.fillStyle='#90633d';x.fillRect(440,140,135,150);x.fillStyle='#b18555';x.beginPath();x.moveTo(425,140);x.lineTo(555,140);x.lineTo(585,168);x.lineTo(455,168);x.closePath();x.fill();x.strokeStyle='#533a25';x.lineWidth=3;x.strokeRect(440,168,135,122);const t=Math.max(0,Math.min(1,(i-30)/40)),cx=130+t*270; x.drawImage(window.coffee,35,0,540,400,cx-120,130,240,178);}
        else{const cx=100+Math.max(0,Math.min(1,(i-18)/60))*400;x.fillStyle='#174de4';x.fillRect(cx,150,85,85);x.fillStyle='#b42e36';x.fillRect(450,300,70,70);}
        return c.toDataURL().split(',')[1];},{kind,i});await writeFile(path.join(dir,String(i).padStart(3,'0')+'.png'),Buffer.from(data,'base64'));
    }
    const target=new URL(kind+'.mp4',out),r=spawnSync('ffmpeg',['-y','-loglevel','error','-framerate','12','-i',path.join(dir,'%03d.png'),'-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',fileURLToPath(target)],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);
  }
  const names=[...Object.keys(stills),'workshop.mp4','blue.mp4','road.jpg'];const files=[];
  for(const name of names){const b=await readFile(new URL(name,out));files.push({path:'demo-samples/'+name,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
  await writeFile(new URL('manifest.json',out),JSON.stringify({version:'1.0.0',files},null,2)+'\n');
}finally{await browser.close();const absolute=path.resolve(temporary);if(path.dirname(absolute)!==path.resolve(tmpdir())||!path.basename(absolute).startsWith('camera-demo-frames-'))throw Error('Unexpected temporary path');await rm(absolute,{recursive:true,force:true});}
