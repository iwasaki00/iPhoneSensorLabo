import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const root = new URL('../', import.meta.url), target = new URL('public/', root), manifest = new URL('text-assets.json', target);
const hash = b => createHash('sha256').update(b).digest('hex');
if (process.argv.includes('--verify')) {
  const data = JSON.parse(await readFile(manifest));
  for (const f of data.files) if (hash(await readFile(new URL(f.path, target))) !== f.sha256) throw Error('Text asset mismatch: ' + f.path);
  console.log(`Verified ${data.files.length} text/marker assets`);
} else {
  const files = [];
  async function copy(source, path, license) {
    const dest = new URL(path, target); await mkdir(new URL('./', dest), { recursive: true }); await copyFile(new URL('node_modules/' + source, root), dest);
    const b = await readFile(dest); files.push({ path, bytes: b.length, sha256: hash(b), source, license });
  }
  for (const f of await readdir(new URL('node_modules/tesseract.js-core/', root))) if (f.endsWith('.wasm.js')) await copy('tesseract.js-core/' + f, 'vendor/ocr/core/' + f, 'Apache-2.0');
  await copy('tesseract.js/dist/tesseract.min.js', 'vendor/ocr/tesseract.min.js', 'Apache-2.0');
  await copy('tesseract.js/dist/worker.min.js', 'vendor/ocr/worker.min.js', 'Apache-2.0');
  for (const lang of ['eng', 'jpn']) await copy(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, `vendor/ocr/lang/${lang}.traineddata.gz`, 'Apache-2.0 (trained weights); MIT (npm wrapper)');
  await copy('@zxing/library/umd/index.min.js', 'vendor/text/zxing.js', 'Apache-2.0');
  await copy('@techstark/opencv-js/dist/opencv.js', 'vendor/text/opencv.js', 'Apache-2.0');
  for (const f of ['cv', 'aruco']) await copy(`js-aruco2/src/${f}.js`, `vendor/text/aruco-${f}.js`, 'MIT; bundled BSD notices');
  for (const [pkg, name] of [['tesseract.js','LICENSE.md'],['tesseract.js-core','LICENSE'],['@zxing/library','LICENSE'],['@techstark/opencv-js','LICENSE'],['js-aruco2','LICENSE.txt']]) await copy(pkg + '/' + name, 'licenses/' + pkg.replaceAll('/', '-') + '-LICENSE.txt', pkg === 'js-aruco2' ? 'MIT + BSD notices' : 'Apache-2.0');
  for (const name of ['tesseract.min.js.LICENSE.txt','worker.min.js.LICENSE.txt']) await copy('tesseract.js/dist/' + name,'licenses/' + name,'Bundled third-party notices');
  const require = createRequire(import.meta.url), { AR } = require('js-aruco2');
  const dictionary = new AR.Dictionary('ARUCO_MIP_36h12');
  await writeFile(new URL('src/textmarker/dictionary.json', root), JSON.stringify({ name: dictionary.dicName, bits: 6, codes: dictionary.codeList }) + '\n');
  await writeFile(manifest, JSON.stringify({ packages: { tesseract: '7.0.0', core: '7.0.0', zxing: '0.23.0', opencv: '4.12.0-release.1', aruco: '2.0.0', languages: '1.0.0 / 4.0.0_best_int' }, files }, null, 2) + '\n');
}
