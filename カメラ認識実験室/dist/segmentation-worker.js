/* Classic Worker for MediaPipe's importScripts-based WASM loader. CPU delegate. */
let segmenter, model;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      model = data.model;
      self.exports = {};
      importScripts(new URL('vendor/vision_bundle.js', data.base).href);
      const files = await self.exports.FilesetResolver.forVisionTasks(new URL('vendor/wasm', data.base).href);
      segmenter = await self.exports.ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL('models/' + data.file, data.base).href, delegate: 'CPU' },
        runningMode: 'VIDEO', outputCategoryMask: model === 'multiclass', outputConfidenceMasks: true
      });
      self.postMessage({ labels: segmenter.getLabels() });
    } else if (data.type === 'infer') {
      let result;
      try {
        const start = performance.now();
        result = segmenter.segmentForVideo(data.bitmap, data.timestamp);
        const duration = performance.now() - start, masks = result.confidenceMasks;
        if (!masks?.length) throw new Error('信頼度マスクを取得できません');
        const reference = masks[0], width = reference.width, height = reference.height;
        const foreground = new Float32Array(width * height), categories = new Uint8Array(width * height);
        if (model === 'person') {
          const values = masks[masks.length === 1 ? 0 : 1].getAsFloat32Array();
          for (let i = 0; i < foreground.length; i++) { foreground[i] = values[i]; categories[i] = values[i] >= 0.5 ? 1 : 0; }
        } else {
          if (masks.length !== 6 || !result.categoryMask) throw new Error('モデルの6カテゴリ出力と一致しません');
          categories.set(result.categoryMask.getAsUint8Array());
          const background = masks[0].getAsFloat32Array();
          for (let i = 0; i < foreground.length; i++) foreground[i] = 1 - background[i];
        }
        self.postMessage({ width, height, foreground, categories, duration }, [foreground.buffer, categories.buffer]);
      } finally { result?.close(); data.bitmap.close(); }
    }
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
