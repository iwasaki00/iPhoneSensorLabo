/* Classic Worker: MediaPipe's WASM loader uses importScripts. */
let detector;
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'init') {
      self.exports = {};
      importScripts(new URL('vendor/vision_bundle.js', data.base).href);
      const files = await self.exports.FilesetResolver.forVisionTasks(new URL('vendor/wasm', data.base).href);
      detector = await self.exports.ObjectDetector.createFromOptions(files, {
        baseOptions: {modelAssetPath:new URL('models/efficientdet_lite0.tflite', data.base).href,delegate:'CPU'},
        runningMode:'VIDEO',scoreThreshold:0.1,maxResults:20
      });
      self.postMessage({ready:true});
    } else if (data.type === 'infer') {
      try {
        const start=performance.now();
        const result=detector.detectForVideo(data.bitmap,data.timestamp);
        self.postMessage({detections:result.detections,duration:performance.now()-start});
      } finally { data.bitmap.close(); }
    }
  } catch (error) {self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
