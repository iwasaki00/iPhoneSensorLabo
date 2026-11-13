/* Local-only classic broker. Libraries are loaded for the requested engine only. */
let busy = false, disposed = false, ocr, ocrLanguage, detector, readyCV = false, reference;
const ownedWorkers = [], NativeWorker = self.Worker;
if (NativeWorker) self.Worker = class extends NativeWorker { constructor(...args) { super(...args); ownedWorkers.push(this); } };
async function cvReady(base) {
  if (readyCV) return;
  importScripts(new URL('vendor/text/opencv.js', base).href);
  if (!self.cv.Mat) await new Promise((resolve, reject) => { self.cv.then(()=>resolve()); setTimeout(() => reject(Error('OpenCV初期化がタイムアウトしました。')), 45000); });
  readyCV = true;
}
function features(image) {
  const input = cv.matFromImageData(image), gray = new cv.Mat(), keys = new cv.KeyPointVector(), descriptors = new cv.Mat(), mask = new cv.Mat(), orb = new cv.ORB();
  try { cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY); orb.detectAndCompute(gray, mask, keys, descriptors); return { keys, descriptors, width: image.width, height: image.height }; }
  catch (e) { keys.delete(); descriptors.delete(); throw e; }
  finally { input.delete(); gray.delete(); mask.delete(); orb.delete(); }
}
function dropReference() { reference?.keys.delete(); reference?.descriptors.delete(); reference = undefined; }
function match(image, ref) {
  if (!reference || reference.id !== ref.id) { dropReference(); reference = { ...features(ref.image), id: ref.id }; }
  const current = features(image), matcher = new cv.BFMatcher(cv.NORM_HAMMING, false), pairs = new cv.DMatchVectorVector();
  const resources = [matcher, pairs, current.keys, current.descriptors];
  try {
    const total = reference.keys.size();
    if (total < 12 || current.keys.size() < 12) return { features: total, matches: 0, inliers: 0, items: [], note: '特徴点が不足しています。文字・模様・角が多い平面画像を登録してください。' };
    matcher.knnMatch(reference.descriptors, current.descriptors, pairs, 2);
    const source = [], dest = [], used = new Set();
    for (let i = 0; i < pairs.size(); i++) { const pair = pairs.get(i); try { if (pair.size() < 2) continue; const a = pair.get(0), b = pair.get(1); if (a.distance < .72 * b.distance && !used.has(a.trainIdx)) { used.add(a.trainIdx); const p = reference.keys.get(a.queryIdx).pt, q = current.keys.get(a.trainIdx).pt; source.push(p.x,p.y); dest.push(q.x,q.y); } } finally { pair.delete(); } }
    const matches = source.length / 2;
    if (matches < 10) return { features: total, matches, inliers: 0, items: [], note: '十分な一致候補がありません。角度・距離・照明を調整してください。' };
    const a = cv.matFromArray(matches, 1, cv.CV_32FC2, source), b = cv.matFromArray(matches, 1, cv.CV_32FC2, dest), mask = new cv.Mat(); resources.push(a,b,mask);
    const h = cv.findHomography(a,b,cv.RANSAC,3,mask); resources.push(h);
    let inliers = 0; for (const v of mask.data) if (v) inliers++;
    if (h.empty() || inliers < 8 || inliers / matches < .45) return { features: total, matches, inliers, items: [], note: '射影変換の外れ値が多いため候補を棄却しました。' };
    const corners = cv.matFromArray(4,1,cv.CV_32FC2,[0,0,reference.width,0,reference.width,reference.height,0,reference.height]), output = new cv.Mat(); resources.push(corners,output); cv.perspectiveTransform(corners,output,h);
    const q = Array.from({length:4},(_,i)=>({x:output.data32F[i*2]/image.width,y:output.data32F[i*2+1]/image.height}));
    const cross = q.map((p,i)=>{const b=q[(i+1)%4],c=q[(i+2)%4];return (b.x-p.x)*(c.y-b.y)-(b.y-p.y)*(c.x-b.x);});
    const area = Math.abs(q.reduce((sum,p,i)=>sum+p.x*q[(i+1)%4].y-q[(i+1)%4].x*p.y,0))/2;
    if (!q.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1) || !cross.every(v=>v>0) || area<.005) return {features:total,matches,inliers,items:[],note:'不正な四隅・画面外候補を棄却しました。'};
    return { features: total, matches, inliers, items: [{ category:'登録画像', referenceId:ref.id, corners:q }], note:'平面画像の候補です。実物の同一性・3D姿勢は保証しません。' };
  } finally { for (const r of resources.reverse()) r.delete(); }
}
self.onmessage = async ({ data }) => {
  if (data.type === 'dispose') { disposed=true; ownedWorkers.forEach(w=>w.terminate()); ocr?.terminate(); dropReference(); self.postMessage({disposed:true}); return; }
  if (busy) { self.postMessage({error:'解析の重複要求'}); return; } busy=true;
  try {
    const {base,kind,image,settings:s}=data; let result; const start=performance.now();
    if (kind === 'ocr') {
      if (!NativeWorker) throw Error('このブラウザではOCR用の入れ子Workerを起動できません。Safariを更新するか、Chrome／Edgeで試してください。');
      if (!ocr || ocrLanguage !== s.language) {
        if (!self.Tesseract) importScripts(new URL('vendor/ocr/tesseract.min.js',base).href);
        self.postMessage({progress:'OCRモデル・言語データを同じサイトから読み込み中…'});
        ocr=await Tesseract.createWorker(s.language,1,{workerPath:new URL('vendor/ocr/worker.min.js',base).href,corePath:new URL('vendor/ocr/core/',base).href,langPath:new URL('vendor/ocr/lang',base).href,workerBlobURL:false,cacheMethod:'none',logger:m=>{if(!disposed)self.postMessage({progress:`OCR: ${m.status} ${Math.round((m.progress||0)*100)}%`});}}); ocrLanguage=s.language;
      }
      const {data:r}=await ocr.recognize(data.png,{}, {text:true,blocks:true}); const items=[];
      for(const block of r.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
        for(const word of line.words||[])for(const symbol of word.symbols||[]){const b=symbol.bbox;items.push({category:'文字',text:symbol.text,confidence:symbol.confidence/100,box:{x:b.x0/image.width,y:b.y0/image.height,width:(b.x1-b.x0)/image.width,height:(b.y1-b.y0)/image.height}});}
        const b=line.bbox;items.push({category:'行',text:line.text,confidence:line.confidence/100,box:{x:b.x0/image.width,y:b.y0/image.height,width:(b.x1-b.x0)/image.width,height:(b.y1-b.y0)/image.height}});
      }
      result={text:r.text,confidence:r.confidence/100,items,note:'編集・コピーは可能です。文字列は自動保存・外部送信しません。'};
    } else if (kind === 'code') {
      if (!self.ZXing) importScripts(new URL('vendor/text/zxing.js',base).href);
      const gray = new Uint8ClampedArray(image.width*image.height);for(let i=0;i<gray.length;i++)gray[i]=(image.data[i*4]*299+image.data[i*4+1]*587+image.data[i*4+2]*114)/1000;
      const reader=new ZXing.MultiFormatReader(), hints=new Map(); hints.set(ZXing.DecodeHintType.TRY_HARDER,true);reader.setHints(hints);
      try { const bitmap=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(gray,image.width,image.height)));let r;
        try{r=reader.decodeWithState(bitmap);}catch(e){if(!(e instanceof ZXing.NotFoundException||e instanceof ZXing.FormatException||e instanceof ZXing.ChecksumException))throw e;r=new ZXing.QRCodeReader().decode(bitmap,new Map([[ZXing.DecodeHintType.PURE_BARCODE,true]]));}
        const points=r.getResultPoints()||[];let normalized=points.map(p=>({x:p.getX()/image.width,y:p.getY()/image.height}));
        if(!normalized.length){const matrix=bitmap.getBlackMatrix(),a=matrix.getTopLeftOnBit(),b=matrix.getBottomRightOnBit();if(a&&b)normalized=[{x:a[0]/image.width,y:a[1]/image.height},{x:b[0]/image.width,y:b[1]/image.height}];}
        result={items:[{category:'コード',format:ZXing.BarcodeFormat[r.getBarcodeFormat()],content:r.getText(),points:normalized}],note:points.length?'1回の解析で1コードを読み取ります。点はエンジンの検出点で、コードの四隅ではありません。':'単独・正面QRの補助読取です。位置は黒画素範囲の近似で、射影された四隅ではありません。'};
      } catch(e) { if (e instanceof ZXing.NotFoundException || e instanceof ZXing.ChecksumException || e instanceof ZXing.FormatException) result={items:[],note:'コード未検出。明るさ・余白・距離を調整してください。'};else throw e; }
      finally { reader.reset(); }
    } else if(kind==='marker') {
      if(!detector){importScripts(new URL('vendor/text/aruco-cv.js',base).href,new URL('vendor/text/aruco-aruco.js',base).href);detector=new AR.Detector({dictionaryName:'ARUCO_MIP_36h12'});}
      result={items:detector.detect(image).map(m=>({category:'マーカー',markerId:m.id,corners:m.corners.map(p=>({x:p.x/image.width,y:p.y/image.height}))})),note:'ARUCO_MIP_36h12 / 画像上の回転角です。3D姿勢ではありません。'};
    } else { self.postMessage({progress:'ORB照合エンジンを準備中…'}); await cvReady(base); if(!data.reference)throw Error('登録画像を選択してください。'); result=match(image,data.reference); }
    if(!disposed)self.postMessage({...result,duration:performance.now()-start});
  } catch(e) { if(!disposed)self.postMessage({error:e instanceof Error?e.message:String(e)}); }
  finally {busy=false;}
};
self.postMessage({ready:true});
