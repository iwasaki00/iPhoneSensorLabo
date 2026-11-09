import { mkdir, readFile, writeFile, cp, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
const target=new URL('public/',root);
const manifestPath=new URL('assets-manifest.json',target);
const modelURL='https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';
const digest=b=>createHash('sha256').update(b).digest('hex');
if(process.argv.includes('--verify')){
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  for(const file of manifest.files){if(digest(await readFile(new URL(file.path,target)))!==file.sha256)throw new Error(`アセット不一致: ${file.path}`);}
  console.log(`Verified ${manifest.files.length} local assets`);
}else{
  await mkdir(new URL('models/',target),{recursive:true});await mkdir(new URL('vendor/',target),{recursive:true});await mkdir(new URL('licenses/',target),{recursive:true});
  await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm/',root),new URL('vendor/wasm/',target),{recursive:true});
  await cp(new URL('node_modules/@mediapipe/tasks-vision/vision_bundle.cjs',root),new URL('vendor/vision_bundle.js',target));
  async function download(url,dest){try{await access(dest);return;}catch{} const response=await fetch(url);if(!response.ok)throw new Error(`${response.status}: ${url}`);await writeFile(dest,Buffer.from(await response.arrayBuffer()));}
  await download(modelURL,new URL('models/efficientdet_lite0.tflite',target));
  await download('https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/LICENSE',new URL('licenses/MediaPipe-APACHE-2.0.txt',target));
  await download('https://raw.githubusercontent.com/google/automl/master/LICENSE',new URL('licenses/EfficientDet-APACHE-2.0.txt',target));
  await cp(new URL('node_modules/vite/LICENSE.md',root),new URL('licenses/Vite-LICENSE.md',target));
  await cp(new URL('node_modules/typescript/LICENSE.txt',root),new URL('licenses/TypeScript-LICENSE.txt',target));
  await cp(new URL('node_modules/playwright-core/LICENSE',root),new URL('licenses/Playwright-LICENSE.txt',target));
  await cp(new URL('THIRD_PARTY_NOTICES.md',root),new URL('licenses/THIRD_PARTY_NOTICES.md',target));
  const paths=['models/efficientdet_lite0.tflite','vendor/vision_bundle.js','vendor/wasm/vision_wasm_internal.js','vendor/wasm/vision_wasm_internal.wasm','vendor/wasm/vision_wasm_nosimd_internal.js','vendor/wasm/vision_wasm_nosimd_internal.wasm'];
  const files=[];for(const path of paths){const bytes=await readFile(new URL(path,target));files.push({path,bytes:bytes.length,sha256:digest(bytes)});}
  let previous;try{previous=JSON.parse(await readFile(manifestPath,'utf8'));}catch{}
  if(previous&&JSON.stringify(previous.files)!==JSON.stringify(files))throw new Error('既存のアセットハッシュと不一致です。変更を確認してください。');
  await writeFile(manifestPath,JSON.stringify({mediapipe:'0.10.21',model:{name:'EfficientDet-Lite0',variant:'int8',revision:1,url:modelURL},files},null,2)+'\n');
  console.log('Prepared pinned, same-origin assets');
}
