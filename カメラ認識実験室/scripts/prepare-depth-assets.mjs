import {mkdir,readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),pub=new URL('public/',root),manifest=new URL('depth-assets.json',pub),sha=b=>createHash('sha256').update(b).digest('hex');
const revision='4472b7362082ad9968fee890ca0f1e5aca36b93d',upstream='a561b849ebae10a6f5ef49e26c83cbbcd36c71bf';
if(process.argv.includes('--verify')){const m=JSON.parse(await readFile(manifest));for(const f of m.files)if(sha(await readFile(new URL(f.path,pub)))!==f.sha256)throw Error('Depth asset mismatch: '+f.path);console.log(`Verified ${m.files.length} depth assets`);}
else{
  const files=[];async function add(path,source,license,expected){const dest=new URL(path,pub);await mkdir(new URL('./',dest),{recursive:true});if(source.startsWith('https:')){try{await access(dest);}catch{const r=await fetch(source);if(!r.ok)throw Error('Depth asset download '+r.status);await writeFile(dest,Buffer.from(await r.arrayBuffer()));}}else await copyFile(new URL(source,root),dest);if(/\.(json|txt|md|mjs)$/.test(path))await writeFile(dest,(await readFile(dest,'utf8')).replace(/\r\n?/g,'\n'));const bytes=await readFile(dest);if(expected&&sha(bytes)!==expected)throw Error('Unexpected model hash');files.push({path,source,license,bytes:bytes.length,sha256:sha(bytes)});}
  const base=`https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${revision}/`;
  await add('vendor/depth/model_q4.onnx',base+'onnx/model_q4.onnx','Apache-2.0','5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8');
  for(const f of ['config.json','preprocessor_config.json'])await add('vendor/depth/'+f,base+f,'Apache-2.0');
  for(const f of ['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])await add('vendor/depth/'+f,'node_modules/onnxruntime-web/dist/'+f,'MIT / bundled third-party notices');
  await add('licenses/Depth-Anything-V2-Small-APACHE-2.0.txt',`https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/${upstream}/LICENSE`,'Apache-2.0');
  for(const f of ['LICENSE','ThirdPartyNotices.txt'])await add('licenses/ONNX-Runtime-'+(f.endsWith('.txt')?f:f+'.txt'),`https://raw.githubusercontent.com/microsoft/onnxruntime/v1.23.2/${f}`,'MIT / bundled third-party notices');
  await writeFile(manifest,JSON.stringify({model:'onnx-community/depth-anything-v2-small',revision,variant:'Q4',runtime:'onnxruntime-web 1.23.2',execution:'Worker / WASM / numThreads=1',upstream,files},null,2)+'\n');
}
