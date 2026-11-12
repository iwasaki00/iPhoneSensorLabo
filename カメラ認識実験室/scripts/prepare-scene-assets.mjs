import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const root = new URL('../', import.meta.url), target = new URL('public/', root), manifestURL = new URL('scene-assets.json', target);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv.includes('--verify')) {
  const manifest = JSON.parse(await readFile(manifestURL, 'utf8'));
  for (const file of manifest.files) { const bytes = await readFile(new URL(file.path, target)); if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error('Scene asset mismatch: ' + file.path); }
  console.log(`Verified ${manifest.files.length} scene assets`);
} else {
  await mkdir(new URL('models/scene/', target), { recursive: true }); await mkdir(new URL('vendor/tfjs-wasm/', target), { recursive: true }); await mkdir(new URL('src/scene/', root), { recursive: true });
  async function download(url, file) { try { return await readFile(file); } catch { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`); const bytes = Buffer.from(await response.arrayBuffer()); await writeFile(file, bytes); return bytes; } }
  const configURL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/deeplab@0.2.2/dist/config.js';
  const configBytes = await download(configURL, new URL('licenses/DeepLab-config.js.txt', target));
  const sandbox = { exports: {} }; vm.runInNewContext(configBytes.toString(), sandbox); const config = sandbox.exports.config;
  let official;
  try { official = { instances: JSON.parse(await readFile(new URL('licenses/DeepLab-weights-license-metadata.json', target), 'utf8')).instances }; }
  catch { const listed = await (await fetch('https://www.kaggle.com/api/v1/models/list?search=deeplab')).json(); official = listed.models.find(model => model.ref === 'tensorflow/deeplab'); }
  const files = [], models = {};
  const track = async path => { const bytes = await readFile(new URL(path, target)); files.push({ path, bytes: bytes.length, sha256: hash(bytes) }); };
  for (const id of ['ade20k', 'cityscapes']) {
    const variation = official.instances.find(item => item.slug === id + '-1-quantized' && item.framework === 'tfJs');
    if (!variation || variation.licenseName !== 'Apache 2.0') throw new Error('Unverified pretrained weight license: ' + id);
    const prefix = `models/scene/${id}/`; await mkdir(new URL(prefix, target), { recursive: true });
    const url = `https://tfhub.dev/tensorflow/tfjs-model/deeplab/${id}/1/quantized/1/1/`;
    const bytes = await download(url + 'model.json?tfjs-format=file', new URL(prefix + 'model.json', target));
    const graph = JSON.parse(bytes); let size = bytes.length;
    await track(prefix + 'model.json');
    for (const group of graph.weightsManifest) for (const path of group.paths) {
      if (!/^[\w.-]+$/.test(path)) throw new Error('Unsafe shard path');
      const shard = await download(url + path + '?tfjs-format=file', new URL(prefix + path, target)); size += shard.length; await track(prefix + path);
    }
    const quantizations = [...new Set(graph.weightsManifest.flatMap(group => group.weights).map(weight => weight.quantization?.dtype).filter(Boolean))];
    if (!quantizations.includes('uint8')) throw new Error('Expected uint8 weight quantization');
    models[id] = { name: `DeepLab v3 ${id === 'ade20k' ? 'ADE20K' : 'Cityscapes'} / MobileNet-v2`, bytes: size, revision: 1, quantization: 'uint8 (1 byte weights; runtime float32)', license: 'Apache-2.0', modelURL: url + 'model.json?tfjs-format=file', card: variation.url + '/1', labels: config.LABELS[id.toUpperCase()], colors: config.COLORMAPS[id.toUpperCase()] };
  }
  for (const name of ['tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm', 'tfjs-backend-wasm-threaded-simd.wasm']) { await copyFile(new URL('node_modules/@tensorflow/tfjs-backend-wasm/dist/' + name, root), new URL('vendor/tfjs-wasm/' + name, target)); await track('vendor/tfjs-wasm/' + name); }
  await download('https://raw.githubusercontent.com/tensorflow/tfjs/tfjs-v4.22.0/LICENSE', new URL('licenses/TensorFlowJS-APACHE-2.0.txt', target));
  await download('https://raw.githubusercontent.com/davidbau/seedrandom/3.0.5/README.md', new URL('licenses/seedrandom-README-MIT.md', target));
  await copyFile(new URL('node_modules/long/LICENSE', root), new URL('licenses/long-APACHE-2.0.txt', target));
  const licenseFile = new URL('licenses/DeepLab-weights-license-metadata.json', target);
  try { await readFile(licenseFile); } catch { await writeFile(licenseFile, JSON.stringify({ checkedAt: new Date().toISOString(), pinnedDownloadVersion: 1, source: 'https://www.kaggle.com/api/v1/models/list?search=deeplab', instances: official.instances.filter(item => ['ade20k-1-quantized', 'cityscapes-1-quantized'].includes(item.slug)).map(({ id, slug, framework, versionId, versionNumber, url, licenseName, totalUncompressedBytes }) => ({ id, slug, framework, versionId, versionNumber, url, licenseName, totalUncompressedBytes })) }, null, 2) + '\n'); }
  await track('licenses/DeepLab-config.js.txt'); await track('licenses/DeepLab-weights-license-metadata.json');
  await track('licenses/TensorFlowJS-APACHE-2.0.txt');
  let previous; try { previous = JSON.parse(await readFile(manifestURL, 'utf8')); } catch { /* first preparation */ }
  if (previous && previous.files.some(old => !files.some(file => file.path === old.path && file.sha256 === old.sha256))) throw new Error('Previously pinned scene asset changed');
  await writeFile(new URL('src/scene/catalog.json', root), JSON.stringify(models, null, 2) + '\n');
  await writeFile(manifestURL, JSON.stringify({ tensorflow: '4.22.0', labelSource: configURL, models, files }, null, 2) + '\n');
  console.log('Prepared licensed, pinned, same-origin scene models');
}
