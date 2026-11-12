import type { SceneModel } from './models';
type Weight = { name: string; shape: number[]; dtype: string; quantization?: { min?: number; scale?: number; dtype: string } };
export function internalSceneSize(size: number) { if (![160, 257, 384].includes(size)) throw new Error('未対応の風景解析サイズ'); return Math.ceil((size - 1) / 32) * 32 + 1; }
/** Adapt only validated, non-learned size constants. The distributed graph and learned filters stay untouched. */
export function adaptSceneSize<T extends { weightSpecs?: Weight[]; weightData?: ArrayBuffer | ArrayBuffer[]; modelTopology?: unknown }>(artifacts: T, model: SceneModel, selectedSize: number): T {
  const size = internalSceneSize(selectedSize);
  if (!artifacts.weightSpecs || !artifacts.weightData || !artifacts.modelTopology) throw new Error('風景モデルのサイズ設定または重み情報が不正です');
  // Keep the exported dilation padding valid (feature size congruent to 1 mod 4).
  const topology = JSON.parse(JSON.stringify(artifacts.modelTopology));
  const pool = topology.node?.find((node: any) => node.name === 'AvgPool2D/AvgPool' && node.op === 'AvgPool');
  const originalPool = model === 'ade20k' ? ['1', '65', '65', '1'] : ['1', '129', '257', '1'];
  const originalStrides = model === 'ade20k' ? ['1', '1', '1', '1'] : originalPool;
  if (!pool || JSON.stringify(pool.attr?.ksize?.list?.i) !== JSON.stringify(originalPool) || JSON.stringify(pool.attr?.strides?.list?.i) !== JSON.stringify(originalStrides) || pool.attr?.padding?.s !== 'VkFMSUQ=' || pool.attr?.data_format?.s !== 'TkhXQw==') throw new Error('風景モデルのプーリング定義が既知のrevisionと一致しません');
  const poolSize = String(Math.ceil(size / 8)); pool.attr.ksize.list.i = ['1', poolSize, poolSize, '1'];
  if (model === 'cityscapes') pool.attr.strides.list.i = ['1', poolSize, poolSize, '1'];
  const pieces = Array.isArray(artifacts.weightData) ? artifacts.weightData : [artifacts.weightData];
  const bytes = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.byteLength, 0));
  let cursor = 0; for (const piece of pieces) { bytes.set(new Uint8Array(piece), cursor); cursor += piece.byteLength; }
  const expected: Record<string, { original: number[]; size: number }> = model === 'ade20k' ? {
    strided_slice_6: { original: [513, 513], size }, 'decoder/ResizeBilinear/size': { original: [129, 129], size: Math.ceil(size / 4) },
    'sub_1/x': { original: [513], size }, 'ResizeBilinear/size': { original: [65, 65], size: Math.ceil(size / 8) }
  } : {
    strided_slice_7: { original: [1025, 2049], size }, 'ResizeBilinear_1/size': { original: [129, 257], size: Math.ceil(size / 8) },
    'sub_1/x': { original: [2049], size }, 'sub/x': { original: [1025], size }
  };
  let offset = 0, patched = 0;
  const specs = artifacts.weightSpecs.map(weight => {
    const count = weight.shape.reduce((a, b) => a * b, 1), dtype = weight.quantization?.dtype ?? weight.dtype;
    const elementBytes = ({ uint8: 1, uint16: 2, float16: 2, bool: 1, int32: 4, float32: 4, complex64: 8 } as Record<string, number>)[dtype];
    if (!elementBytes) throw new Error('未対応の重み形式: ' + dtype);
    const replacement = expected[weight.name], start = offset; offset += count * elementBytes;
    if (!replacement) return weight;
    if (weight.dtype !== 'int32' || weight.quantization?.dtype !== 'uint8' || count !== replacement.original.length || replacement.original.some((value, i) => Math.round(bytes[start + i] * (weight.quantization!.scale ?? NaN) + (weight.quantization!.min ?? NaN)) !== value)) throw new Error('モデルの固定サイズ定数が既知のrevisionと一致しません: ' + weight.name);
    bytes.fill(0, start, offset); patched++;
    return { ...weight, quantization: { ...weight.quantization, min: replacement.size, scale: 1 } };
  });
  if (patched !== 4 || offset !== bytes.byteLength) throw new Error('風景モデルの重み構成が固定定義と一致しません');
  return { ...artifacts, modelTopology: topology, weightSpecs: specs, weightData: bytes.buffer };
}
