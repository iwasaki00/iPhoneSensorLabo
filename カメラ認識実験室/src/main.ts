import './style.css';
import { Camera, Rate, containBox, convert, errorMessage, type Observation, type RawDetection } from './core';
import { ObjectMode } from './modes/object-detector';
import type { RecognitionMode } from './modes/types';
const el = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const video=el<HTMLVideoElement>('video'), overlay=el<HTMLCanvasElement>('overlay');
const start=el<HTMLButtonElement>('start'), switchButton=el<HTMLButtonElement>('switch'), recognition=el<HTMLButtonElement>('recognition');
const threshold=el<HTMLInputElement>('threshold'), resolution=el<HTMLSelectElement>('resolution'), interval=el<HTMLSelectElement>('interval');
const camera=new Camera(video), cameraRate=new Rate(), detectRate=new Rate();
const analysis=document.createElement('canvas');
let mode:RecognitionMode|undefined, active=false, starting=false, enabled=true, facing:'user'|'environment'='environment';
let generation=0, raf=0, videoCallback=0, timer:ReturnType<typeof setTimeout>|undefined, latency:number|null=null;
let observations:Observation[]=[], raw:RawDetection[]=[], resultW=1,resultH=1, lastVideoTime=-1,lastInferenceTime=-1,resultAt=0;
let busy=false;
let modeReady=false;
const status=(s:string)=>{el('status').textContent=s;};
function diagnostics(){
  el('diagnostics').textContent=[`Version: 0.1.0 / OBJECT DETECTION FOUNDATION`,`安全な接続: ${isSecureContext}`,`カメラAPI: ${!!navigator.mediaDevices?.getUserMedia}`,`映像フレーム計測: ${'requestVideoFrameCallback' in video ? 'requestVideoFrameCallback' : '未対応（FPS表示なし）'}`,`実行方式: ${mode?.runtime??'未読込'}`,`モデル: EfficientDet-Lite0 int8 / revision 1`,`MediaPipe: 0.10.21`,`映像: ${video.videoWidth} × ${video.videoHeight}`,`カメラ設定: ${JSON.stringify(camera.settings()??{})}`,`解析長辺: ${resolution.value}px / 待機間隔: ${interval.value}ms`,`信頼度: ${threshold.value}% / 最大20件`,`UA: ${navigator.userAgent}`].join('\n');
}
function showError(e:unknown){el('error-message').textContent=errorMessage(e);el('error').hidden=false;}
function resetResults(){raw=[];observations=[];resultAt=0;el('count').textContent='0';}
function stop(){
  generation++;active=false;starting=false;busy=false;
  clearTimeout(timer);cancelAnimationFrame(raf);
  if(videoCallback && 'cancelVideoFrameCallback' in video)video.cancelVideoFrameCallback(videoCallback);
  videoCallback=0;camera.stop();mode?.dispose();mode=undefined;modeReady=false;
  cameraRate.reset();detectRate.reset();latency=null;lastVideoTime=-1;lastInferenceTime=-1;resetResults();
  overlay.getContext('2d')?.clearRect(0,0,overlay.width,overlay.height);
  el('placeholder').hidden=false;start.textContent='カメラを起動';start.disabled=false;switchButton.disabled=false;
  el('state').textContent='停止中';for(const id of ['camera-fps','detect-fps','latency'])el(id).textContent='—';
  status('停止しました。カメラと認識リソースを解放しました。');diagnostics();
}
function fail(e:unknown){stop();showError(e);}
async function begin(){
  if(starting||active)return;
  if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){showError(new Error('カメラにはHTTPS接続が必要です。PCではlocalhost、iPhoneでは信頼されたHTTPSのURLで開いてください。'));return;}
  starting=true;const token=++generation;start.textContent='キャンセル';switchButton.disabled=true;el('error').hidden=true;
  status('カメラの許可を待っています…');el('state').textContent='起動中';
  try{
    if(!await camera.start(facing,()=>{if(token===generation)fail(new Error('カメラ接続が終了しました。再試行してください。'));})||token!==generation)return;
    starting=false;active=true;switchButton.disabled=false;start.textContent='カメラを停止';
    video.classList.toggle('mirrored',facing==='user');el('placeholder').hidden=true;el('state').textContent='カメラ動作中';
    frameCounter(token);draw(token);diagnostics();
    if(enabled)await loadMode(token);else status('認識OFF。映像のみ表示しています。');
  }catch(e){if(token===generation)fail(e);}
}
async function loadMode(token:number){
  if(mode||!active)return;
  const next=new ObjectMode();mode=next;status('モデルを読み込み中… 初回は少し時間がかかります。');el('state').textContent='モデル読込中';
  try{await next.initialize();if(token!==generation||mode!==next)return;modeReady=true;status(enabled?'端末内で認識中。映像は送信されません。':'認識OFF。映像のみ表示しています。');el('state').textContent=enabled?'認識中':'認識OFF';diagnostics();schedule(token);}
  catch(e){if(token===generation&&mode===next)fail(new Error(`モデル読込失敗: ${errorMessage(e)} 同じサイトのモデル・WASMファイルと接続を確認して再試行してください。`));}
}
function frameCounter(token:number){
  if(!('requestVideoFrameCallback' in video))return;
  videoCallback=video.requestVideoFrameCallback(now=>{if(token!==generation||!active)return;cameraRate.tick(now);frameCounter(token);});
}
function draw(token:number){
  if(token!==generation||!active)return;
  const w=overlay.clientWidth,h=overlay.clientHeight,dpr=Math.min(devicePixelRatio||1,2);
  if(overlay.width!==Math.round(w*dpr)||overlay.height!==Math.round(h*dpr)){overlay.width=Math.round(w*dpr);overlay.height=Math.round(h*dpr);}
  const ctx=overlay.getContext('2d')!;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const now=performance.now();
  const visible=enabled&&now-resultAt<2000?observations:[];
  for(const o of visible){
    const b=containBox(o.box,resultW,resultH,w,h,facing==='user');
    ctx.strokeStyle='#a2ecd2';ctx.lineWidth=2;ctx.strokeRect(b.x,b.y,b.width,b.height);
    const label=`${o.label} ${Math.round(o.score*100)}%`;ctx.font='600 13px system-ui';
    const labelW=Math.min(w,ctx.measureText(label).width+12),x=Math.max(0,Math.min(w-labelW,b.x)),y=Math.max(0,Math.min(h-25,b.y-25));
    ctx.fillStyle='#a2ecd2';ctx.fillRect(x,y,labelW,24);ctx.fillStyle='#102922';ctx.fillText(label,x+6,y+17);
  }
  el('count').textContent=String(visible.length);
  el('camera-fps').textContent=cameraRate.value(now)?.toFixed(1)??'—';
  el('detect-fps').textContent=enabled?(detectRate.value(now)?.toFixed(1)??'—'):'—';
  el('latency').textContent=enabled&&latency!==null?latency.toFixed(1):'—';
  raf=requestAnimationFrame(()=>draw(token));
}
function schedule(token:number){clearTimeout(timer);if(token===generation&&active&&enabled)timer=setTimeout(()=>void infer(token),Number(interval.value));}
async function infer(token:number){
  if(token!==generation||!active||!enabled||!mode||!modeReady||busy)return;
  if(video.readyState<2||!video.videoWidth||video.currentTime===lastVideoTime){schedule(token);return;}
  busy=true;lastVideoTime=video.currentTime;
  const currentMode=mode,limit=Number(resolution.value),scale=Math.min(1,limit/Math.max(video.videoWidth,video.videoHeight));
  analysis.width=Math.max(1,Math.round(video.videoWidth*scale));analysis.height=Math.max(1,Math.round(video.videoHeight*scale));
  try{
    analysis.getContext('2d')!.drawImage(video,0,0,analysis.width,analysis.height);
    const timestamp=Math.max(performance.now(),lastInferenceTime+0.01);lastInferenceTime=timestamp;
    const result=await currentMode.infer(analysis,timestamp);
    if(token!==generation||mode!==currentMode)return;
    if(enabled){raw=result.detections;observations=convert(raw,Number(threshold.value)/100);resultW=analysis.width;resultH=analysis.height;resultAt=performance.now();latency=result.duration;detectRate.tick(resultAt);diagnostics();}
  }catch(e){if(token===generation&&mode===currentMode)fail(new Error(`認識処理失敗: ${errorMessage(e)}`));}
  finally{if(token===generation){busy=false;schedule(token);}}
}
start.onclick=()=>{if(active||starting)stop();else void begin();};
switchButton.onclick=async()=>{const resume=active;stop();facing=facing==='user'?'environment':'user';switchButton.textContent=facing==='user'?'背面に切替':'前面に切替';if(resume)await begin();};
recognition.onclick=()=>{enabled=!enabled;recognition.textContent=`認識 ${enabled?'ON':'OFF'}`;recognition.setAttribute('aria-pressed',String(enabled));resetResults();detectRate.reset();latency=null;clearTimeout(timer);if(active){if(enabled){if(mode){schedule(generation);status('端末内で認識中。');el('state').textContent='認識中';}else void loadMode(generation);}else{status('認識OFF。映像のみ表示しています。');el('state').textContent='認識OFF';}}};
threshold.oninput=()=>{el('threshold-value').textContent=`${threshold.value}%`;observations=convert(raw,Number(threshold.value)/100);diagnostics();};
resolution.onchange=()=>{resetResults();diagnostics();};interval.onchange=diagnostics;
el('retry').onclick=()=>{stop();void begin();};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||starting))stop();});
window.addEventListener('pagehide',stop);diagnostics();
