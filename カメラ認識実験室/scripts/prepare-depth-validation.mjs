import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const target=new URL('../depth-validation.local/',import.meta.url);await mkdir(target,{recursive:true});
const photos='https://raw.githubusercontent.com/DepthAnything/Depth-Anything-V2/a561b849ebae10a6f5ef49e26c83cbbcd36c71bf/assets/examples/';
const files=[
  ['demo01.jpg',photos+'demo01.jpg','35ef1bbb63f6540e49aa9b6302b9b938be4fe8b9c08c07c3694b02396b0e87e0'],
  ['demo02.jpg',photos+'demo02.jpg','c1f116034aa5abd5b5470226be2bb03bd938c8affe90389c52d10fe8b1ac7e21'],
  ['demo03.jpg',photos+'demo03.jpg','764dffd4d97bbacd620bc005fa86837018393ccb5ffd1059c2245a3cacff7782'],
  ['model_quantized.onnx','https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx','fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d']
];
for(const [file,source,sha] of files){const dest=new URL(file,target);let bytes;try{bytes=await readFile(dest);}catch{const r=await fetch(source);if(!r.ok)throw Error('Validation download '+r.status);bytes=Buffer.from(await r.arrayBuffer());}if(createHash('sha256').update(bytes).digest('hex')!==sha)throw Error('Validation source hash mismatch: '+file);await writeFile(dest,bytes);}
console.log('Prepared ignored, local-only real-photo/UINT8 test inputs. They are not included in dist.');
