import { mkdir, readFile, writeFile, cp, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
await import('./prepare-scene-assets.mjs');
await import('./prepare-text-assets.mjs');
await import('./prepare-depth-assets.mjs');
const target=new URL('public/',root);
const manifestPath=new URL('assets-manifest.json',target);
const modelURL='https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';
const digest=b=>createHash('sha256').update(b).digest('hex');
const segmentModels = [
  {name:'SelfieSegmenter (square)',file:'selfie_segmenter.tflite',variant:'float16',revision:1,categories:['background','person'],url:'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',license:'Apache-2.0'},
  {name:'SelfieMulticlass 256x256',file:'selfie_multiclass_256x256.tflite',variant:'float32',revision:1,categories:['background','hair','body-skin','face-skin','clothes','others'],url:'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',license:'Apache-2.0'}
];
if(process.argv.includes('--verify')){
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(!segmentModels.every(m=>manifest.files.some(f=>f.path==='models/'+m.file)))throw new Error('領域モデルが未配置です。npm run assets を実行してください。');
  for(const file of manifest.files){if(digest(await readFile(new URL(file.path,target)))!==file.sha256)throw new Error(`アセット不一致: ${file.path}`);}
  console.log(`Verified ${manifest.files.length} local assets`);
}else{
  await mkdir(new URL('models/',target),{recursive:true});await mkdir(new URL('vendor/',target),{recursive:true});await mkdir(new URL('licenses/',target),{recursive:true});
  await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm/',root),new URL('vendor/wasm/',target),{recursive:true});
  await cp(new URL('node_modules/@mediapipe/tasks-vision/vision_bundle.cjs',root),new URL('vendor/vision_bundle.js',target));
  async function download(url,dest){try{await access(dest);return;}catch{} const response=await fetch(url);if(!response.ok)throw new Error(`${response.status}: ${url}`);await writeFile(dest,Buffer.from(await response.arrayBuffer()));}
  await download(modelURL,new URL('models/efficientdet_lite0.tflite',target));
  for(const model of segmentModels)await download(model.url,new URL('models/'+model.file,target));
  await download('https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/LICENSE',new URL('licenses/MediaPipe-APACHE-2.0.txt',target));
  await download('https://raw.githubusercontent.com/google/automl/master/LICENSE',new URL('licenses/EfficientDet-APACHE-2.0.txt',target));
  await cp(new URL('node_modules/vite/LICENSE.md',root),new URL('licenses/Vite-LICENSE.md',target));
  await cp(new URL('node_modules/typescript/LICENSE.txt',root),new URL('licenses/TypeScript-LICENSE.txt',target));
  await cp(new URL('node_modules/playwright-core/LICENSE',root),new URL('licenses/Playwright-LICENSE.txt',target));
  await cp(new URL('THIRD_PARTY_NOTICES.md',root),new URL('licenses/THIRD_PARTY_NOTICES.md',target));
  await cp(new URL('licenses/MediaPipe-APACHE-2.0.txt',target),new URL('licenses/Segmentation-APACHE-2.0.txt',target));
  for(const name of await readdir(new URL('licenses/',target))){const file=new URL('licenses/'+name,target);await writeFile(file,(await readFile(file,'utf8')).replace(/\r\n?/g,'\n'));}
  const paths=['models/efficientdet_lite0.tflite','vendor/vision_bundle.js','vendor/wasm/vision_wasm_internal.js','vendor/wasm/vision_wasm_internal.wasm','vendor/wasm/vision_wasm_nosimd_internal.js','vendor/wasm/vision_wasm_nosimd_internal.wasm',...segmentModels.map(m=>'models/'+m.file)];
  const files=[];for(const path of paths){const bytes=await readFile(new URL(path,target));files.push({path,bytes:bytes.length,sha256:digest(bytes)});}
  let previous;try{previous=JSON.parse(await readFile(manifestPath,'utf8'));}catch{}
  if(previous&&previous.files.some(old=>!files.some(f=>f.path===old.path&&f.sha256===old.sha256&&f.bytes===old.bytes)))throw new Error('既存のアセットハッシュと不一致です。変更を確認してください。');
  await writeFile(manifestPath,JSON.stringify({mediapipe:'0.10.21',model:{name:'EfficientDet-Lite0',variant:'int8',revision:1,url:modelURL},segmentModels,files},null,2)+'\n');
  console.log('Prepared pinned, same-origin assets');
}
