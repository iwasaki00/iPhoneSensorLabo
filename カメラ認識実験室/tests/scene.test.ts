import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sceneModels, sceneColors, sceneLabel, sceneOccupancy, type SceneData } from '../src/scene/models.ts';
import { sceneDefaults, parseSceneSettings } from '../src/scene/settings.ts';
import { sceneComposite } from '../src/scene/composite.ts';
import { AdaptiveLoad } from '../src/segmentation/stability.ts';
import { readRecords, exportRecords, type Experiment } from '../src/experiments.ts';
import { adaptSceneSize, internalSceneSize } from '../src/scene/resize.ts';
test('experimental internal sizes only change four validated non-learned constants', async () => {
  for (const model of ['ade20k', 'cityscapes'] as const) {
    const graph = JSON.parse(await readFile(`public/models/scene/${model}/model.json`, 'utf8'));
    const binary = await readFile(`public/models/scene/${model}/${graph.weightsManifest[0].paths[0]}`), original = Uint8Array.from(binary);
    const specs = graph.weightsManifest[0].weights;
    const result = adaptSceneSize({ weightSpecs: specs, weightData: original.buffer, modelTopology: graph.modelTopology }, model, 257);
    const changed = specs.filter((weight: any, i: number) => JSON.stringify(weight) !== JSON.stringify(result.weightSpecs[i]));
    assert.equal(changed.length, 4); assert.ok(changed.every((weight: any) => weight.dtype === 'int32' && !/weights|biases/.test(weight.name)));
    assert.deepEqual([...original], [...binary]); assert.equal(result.weightData.byteLength, original.byteLength);
    assert.deepEqual(result.modelTopology.node.find((node: any) => node.op === 'AvgPool').attr.ksize.list.i, ['1', '33', '33', '1']);
    for (const selected of [160, 384]) { const resized = adaptSceneSize({ weightSpecs: specs, weightData: original.buffer, modelTopology: graph.modelTopology }, model, selected); assert.deepEqual(resized.modelTopology.node.find((node: any) => node.op === 'AvgPool').attr.ksize.list.i, ['1', String(Math.ceil(internalSceneSize(selected) / 8)), String(Math.ceil(internalSceneSize(selected) / 8)), '1']); }
    assert.throws(() => adaptSceneSize({ weightSpecs: specs, weightData: original.buffer, modelTopology: graph.modelTopology }, model, 999));
    assert.throws(() => adaptSceneSize({ weightSpecs: specs.filter((weight: any) => !weight.name.startsWith('sub_1/x')), weightData: original.buffer, modelTopology: graph.modelTopology }, model, 257));
  }
  assert.equal(internalSceneSize(160), 161); assert.equal(internalSceneSize(384), 385);
});
test('actual learned logits channels match all official labels and colors', async () => {
  for (const id of ['ade20k', 'cityscapes'] as const) {
    const graph = JSON.parse(await readFile(`public/models/scene/${id}/model.json`, 'utf8'));
    const logits = graph.weightsManifest.flatMap((group: any) => group.weights).find((weight: any) => weight.name === 'logits/semantic/biases');
    assert.equal(logits.shape[0], sceneModels[id].labels.length); assert.ok(sceneModels[id].colors.length >= logits.shape[0]);
    assert.equal(new Set(sceneColors[id].slice(0, logits.shape[0]).map(color => color.join(','))).size, logits.shape[0]);
  }
  assert.equal(sceneModels.ade20k.labels.length, 151); assert.equal(sceneModels.cityscapes.labels.length, 19);
  assert.equal(sceneModels.cityscapes.labels.includes('floor'), false); assert.equal(sceneLabel('ade20k', 3), '空');
});
const data: SceneData = { model: 'ade20k', width: 2, height: 1, categories: new Uint8Array([3, 7]), duration: 100, backend: 'wasm', tensors: 200, tensorBytes: 1000, memoryReliable: true };
const source = new Uint8ClampedArray([40, 80, 120, 255, 150, 70, 20, 255]);
test('occupancy uses category IDs and rejects mismatched labels', () => {
  const rates = sceneOccupancy(data); assert.deepEqual(rates.map(r => r.ratio), [.5, .5]); assert.deepEqual(rates.map(r => r.name), ['空', '道路']);
  assert.throws(() => sceneOccupancy({ model: 'cityscapes', categories: new Uint8Array([255]) }));
});
test('all scene display/effects affect selected pixels and preserve source', () => {
  assert.deepEqual(sceneComposite(source, 2, 1, data, { ...sceneDefaults, display: 'original' }), source);
  const mask = sceneComposite(source, 2, 1, data, { ...sceneDefaults, display: 'mask' }); assert.deepEqual([...mask.slice(0, 3)], sceneModels.ade20k.colors[3]);
  for (const display of ['tint', 'mono', 'brightness', 'solid'] as const) { const output = sceneComposite(source, 2, 1, data, { ...sceneDefaults, display, brightness: 150 }); assert.notDeepEqual(output.slice(0, 3), source.slice(0, 3)); assert.deepEqual(output.slice(4), source.slice(4)); }
  const outside = sceneComposite(source, 2, 1, data, { ...sceneDefaults, display: 'outside-mono' }); assert.deepEqual(outside.slice(0, 4), source.slice(0, 4)); assert.equal(outside[4], outside[5]);
  for (const display of ['overlay', 'highlight'] as const) assert.notDeepEqual(sceneComposite(source, 2, 1, data, { ...sceneDefaults, display }), source);
  assert.deepEqual(source, new Uint8ClampedArray([40, 80, 120, 255, 150, 70, 20, 255]));
});
test('scene settings isolate old settings and constrain resolution/interval; load control reused safely', () => {
  assert.deepEqual(parseSceneSettings('bad'), sceneDefaults); const s = parseSceneSettings('{"resolution":9999,"interval":0,"brightness":900,"model":"unknown"}'); assert.equal(s.resolution, 257); assert.equal(s.interval, 2000); assert.equal(s.brightness, 200); assert.equal(s.model, 'ade20k');
  assert.equal(parseSceneSettings('{"model":"cityscapes","target":150}').target, 10);
  const load = new AdaptiveLoad([1000, 2000, 5000, 10000], 15000); load.add(10000); assert.equal(load.wait('auto', 2000), 15000); assert.equal(load.wait('manual', 10000), 10000); load.reset(); assert.equal(load.wait('auto', 2000), 2000);
});
test('old experiment records survive and scene comparisons export metadata only', () => {
  const old: Experiment = { version: '0.3.1', at: '2026-11-12T06:00:00Z', mode: '色', model: 'none', resolution: '160x120', renderFPS: null, inferenceFPS: null, averageMs: 100, maximumMs: 100, waitMs: 200, loadMode: 'manual', runtime: 'cpu', userAgent: 'test', language: 'ja', platform: 'test', cores: 4 };
  assert.deepEqual(readRecords(JSON.stringify([old])), [old]);
  const record = { ...old, scene: { context: 'outdoor', inputKind: 'still', inputId: 'input-1', modelBytes: 2438371, loadMs: 200, inferenceMs: 100, internalResolution: '257×257', categories: [{ id: 3, name: '空', ratio: .5, image: 'private' }] } };
  const json = exportRecords([record], 'json'), csv = exportRecords([record], 'csv'); assert.match(json, /input-1/); assert.match(csv, /categoryOccupancy/); assert.equal(json.includes('private'), false); assert.equal(csv.includes('private'), false);
  assert.equal(readRecords(json)[0].scene?.internalResolution, '257×257');
});
