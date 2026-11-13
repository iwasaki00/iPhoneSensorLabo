# 採用ライブラリ・モデル・配布条件

## v0.4.0 風景認識（確認日: 2026-11-12）

| 採用物 | 固定版・容量 | ライセンス |
| --- | --- | --- |
| DeepLab v3 ADE20K / MobileNet-v2 | 1byte量子化 revision 1、JSON＋重み2,438,371 bytes | 学習済み重みの配布元variationがApache-2.0と明示。[公式カード](https://www.kaggle.com/models/tensorflow/deeplab/TfJs/ade20k-1-quantized/1) |
| DeepLab v3 Cityscapes / MobileNet-v2 | 1byte量子化 revision 1、JSON＋重み2,237,643 bytes | 学習済み重みの配布元variationがApache-2.0と明示。[公式カード](https://www.kaggle.com/models/tensorflow/deeplab/TfJs/cityscapes-1-quantized/1) |
| @tensorflow/tfjs-core、tfjs-converter、tfjs-backend-wasm、tfjs-backend-webgl、tfjs-backend-cpu | すべて4.22.0 | Apache-2.0。`public/licenses/TensorFlowJS-APACHE-2.0.txt` |
| DeepLabの公開ラベル・配色定義 | @tensorflow-models/deeplab 0.2.2からの定義 | Apache-2.0 / Copyright 2019 Google LLC。元定義と帰属表示を `public/licenses/DeepLab-config.js.txt` に保持。ラッパー自体は実行依存に追加しない。 |
| seedrandom | 3.0.5（推移依存） | MIT / Copyright David Bau。`public/licenses/seedrandom-README-MIT.md` に許諾文・帰属表示を保持。 |
| long | 4.0.0（推移依存） | Apache-2.0。`public/licenses/long-APACHE-2.0.txt` |

モデル原本は無改変で同梱。読込時にメモリ上のコピーだけを実験用内部サイズ161/257/385へ変更します。変更するのは検証済みの非学習サイズ定数4個とグローバルプーリングのサイズ／ストライドで、学習済みフィルタ・バイアスは維持します。変更説明は [モデル選定資料](docs/SCENE_MODELS.md)、処理は `src/scene/resize.ts` に記載。標準サイズと同じ精度を保証しません。

重みのライセンス確認証跡は `public/licenses/DeepLab-weights-license-metadata.json`、全モデルとWASMのSHA-256は `public/scene-assets.json`。学習データセット画像の利用条件とは区別し、ADE20K／Cityscapesの画像は配布しません。配布時には本ファイル、Apache本文、MIT許諾文、モデルの帰属・変更説明を保持してください。

v0.3.0追加モデル（確認日: 2026-11-10）:

| モデル | 配布版 | ライセンスと根拠 |
| --- | --- | --- |
| SelfieSegmenter (square) | float16 revision 1、249,537 bytes | Apache-2.0。[Googleモデルカード](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf)。Google / Tingbo Hou、Siargey Pisarchyk、Karthik Raveendran |
| SelfieMulticlass 256×256 | float32 revision 1、16,371,837 bytes | Apache-2.0。[Googleモデルカード](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf)。Google / Adel Ahmadyan |

モデルは無改変で同梱しています。固定URL、カテゴリ、SHA-256は `public/assets-manifest.json` に記録しています。配布時は `public/licenses/Segmentation-APACHE-2.0.txt` と本ファイルを保持してください。ライセンス文書は内容を保ってLFへ改行統一しています。エンジンは既存の `@mediapipe/tasks-vision@0.10.21` を共有し、新たなnpm依存は追加していません。

v0.2.0の色・動き・輪郭処理はCanvas APIと自作TypeScriptによる通常の画像処理です。OpenCV.jsや新たな依存ライブラリ・AIモデルは追加していません。対象処理を長辺320pxに制限でき、HSV・連結領域・Sobel・凸包・重心追跡に必要な処理を小さく実装できるため、OpenCV.jsの追加ダウンロード・WASM初期化・Mat管理を避けました。既存の物体認識の固定版とライセンスは維持しています。

確認日: 2026-11-09。直接依存はpackage.jsonで完全固定し、推移依存はpackage-lock.jsonで固定しています。ライセンス本文は `public/licenses/` に同梱し、静的ビルドにも含めます。

| 採用物 | 固定版 | 用途 | ライセンス・一次資料 |
| --- | --- | --- | --- |
| @mediapipe/tasks-vision | 0.10.21 | JS API、WASM SIMD/非SIMD | Apache-2.0。[公式ライセンス](https://github.com/google-ai-edge/mediapipe/blob/v0.10.21/LICENSE) |
| EfficientDet-Lite0 | int8 / revision 1 | COCOの80カテゴリ、320×320入力 | Apache-2.0。[上流実装とLICENSE](https://github.com/google/automl/tree/master/efficientdet)、[公式モデルカード](https://github.com/tensorflow/tfhub.dev/blob/master/assets/docs/tensorflow/models/efficientdet/lite0/int8/lite/1.md) |
| Vite | 6.4.1 | 開発サーバー・静的ビルド | MIT。`node_modules/vite/LICENSE.md`（同梱依存の表記も保持） |
| TypeScript | 5.9.3 | 型検査 | Apache-2.0。`node_modules/typescript/LICENSE.txt` |
| @playwright/test / playwright / playwright-core | 1.56.1 | PC関連テストのみ | Apache-2.0。[公式LICENSE](https://github.com/microsoft/playwright/blob/v1.56.1/LICENSE) |

モデルは[GoogleのObject Detector公式ガイド](https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector)が示すint8モデルを採用しています。ガイドのページ本文のCC BY 4.0と、モデル・実装のライセンスは別です。[TensorFlowの公式配布ページ](https://www.kaggle.com/models/tensorflow/efficientdet/TfLite/lite0-int8)の公開APIで `licenseName: Apache 2.0`、`versionNumber: 1` を確認しました。取得元と確認情報は `docs/model-source-metadata.json` に記録しています。学習元COCOの画像・アノテーションは配布物に含めません。

モデル配布元（revision固定）:

```text
https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite
SHA-256: 0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb
サイズ: 4,602,795 bytes
```

## v0.6.0 文字・マーカー追加（確認日2026-11-13）

| 採用物 | 固定版 | ライセンス・再配布条件 |
| --- | --- | --- |
| Tesseract.js / tesseract.js-core（WASM内包JS） | 7.0.0 / 7.0.0 | Apache-2.0。[本体](https://github.com/naptha/tesseract.js)、[core](https://github.com/naptha/tesseract.js-core)。本文と同梱依存の帰属を `tesseract.js-LICENSE.txt`、`tesseract.js-core-LICENSE.txt`、2つの `*.js.LICENSE.txt` に保持 |
| 英語・日本語LSTM学習済みデータ | @tesseract.js-data/eng・jpn 各1.0.0、4.0.0_best_int | 学習済み重みはApache-2.0。[上流tessdata](https://github.com/naptha/tessdata)のLICENSEを確認。npmラッパーはMITで、配布するのはgzipのtraineddataのみ。eng 2,952,873 bytes、jpn 2,030,256 bytes。OCRコードのライセンスだけから重みの条件を推定していない |
| @zxing/library | 0.23.0 | Apache-2.0。[公式](https://github.com/zxing-js/library)、`@zxing-library-LICENSE.txt` |
| @techstark/opencv-js / OpenCV WASM内包JS | 4.12.0-release.1 | Apache-2.0。[配布元](https://github.com/TechStark/opencv-js)、`@techstark-opencv-js-LICENSE.txt`。ORBなどのAPIを利用、バイナリ内部は変更しない |
| js-aruco2 / CV・AR・ARUCO_MIP_36h12辞書 | 2.0.0 | MITおよび同梱ArUco/OpenCVのBSD帰属。[公式](https://github.com/damianofalcioni/js-aruco2)、`js-aruco2-LICENSE.txt`を全体保持。生成辞書は固定版から抽出 |

新規JavaScript・許諾文は内容を変えずLFへ改行統一しています。新規実行資産のコピー元・bytes・SHA-256・パッケージ版は `public/text-assets.json` に記録し、buildで照合します。`npm ci && npm run assets` で固定版から再配置できます。上記の許諾・著作権表示、Apache本文、同梱依存のnotice、既存モデルの帰属・変更説明を配布時も保持してください。@zxing/browserは調査のみで採用・配布していません。調査と容量・採否は [v0.6設計資料](docs/V0_6_0.md) に記録しています。

## 配布時に保持するもの

v0.8.1追加: `samples/coffee.png`、Rachel Michetti撮影、scikit-image v0.25.2配布、CC0。[公式の写真別ライセンス](https://scikit-image.org/docs/0.25.x/api/skimage.data.html#skimage.data.coffee)。600×400、466,706 bytes、無改変。出典・SHA-256・CC0リンクを`public/samples/coffee-LICENSE.txt`に記録し、写真と一緒にdistへ配置します。新しいAIモデル・認識ライブラリは追加していません。既存Q4モデルのライセンス・版・内部構造は変更しません。

v0.8.0追加（2026-11-14確認）:

| 配布物 | 固定版・容量 | ライセンス・出典 |
| --- | --- | --- |
| Depth Anything V2 Small Q4 ONNX | onnx-community/depth-anything-v2-small、revision `4472b7362082ad9968fee890ca0f1e5aca36b93d`、27,404,416 bytes | Apache-2.0。[ONNX配布元](https://huggingface.co/onnx-community/depth-anything-v2-small)、[Small重みのライセンスを明記した上流](https://github.com/DepthAnything/Depth-Anything-V2)。Small以外のCC-BY-NCモデルは採用しない |
| config.json / preprocessor_config.json | 同revision、LF配布36 / 436 bytes | 同配布元のApache-2.0。設定・出典として保持。使用する前処理の差はV0_8_0.mdに記載 |
| ONNX Runtime Web | npm完全固定1.23.2、WASM 11,905,541 bytes、関連MJS 49,856 / 20,321 bytes | MIT。[公式ソース](https://github.com/microsoft/onnxruntime/tree/v1.23.2)。LICENSEとThirdPartyNoticesの全体を同梱。WASM名にthreadedを含むが実行はnumThreads=1 |

重みは無改変。設定・MJS・ライセンスの改行はLFに統一。`public/depth-assets.json`に取得元・版・容量・SHA-256を記録し、`scripts/prepare-depth-assets.mjs`で固定版から配置します。`Depth-Anything-V2-Small-APACHE-2.0.txt`、`ONNX-Runtime-LICENSE.txt`、`ONNX-Runtime-ThirdPartyNotices.txt`、本一覧と帰属を配布時も保持してください。Q4と比較したUINT8重み、および検証写真はdistへ配布しません。モデルの取得通信と画像送信は別であり、アプリに画像・深度マップの送信処理はありません。

- Apache-2.0の本文、上流の著作権・帰属表示を保持する。変更した上流ファイルには変更を明示する。上流がNOTICEを提供する場合はその帰属表示も保持する。
- MITの著作権表示・許諾文を保持する。
- `public/licenses/`、`THIRD_PARTY_NOTICES.md`、`public/assets-manifest.json` を保持する。準備スクリプトは一覧のコピーも `public/licenses/` に配置する。
- Vite、TypeScript、Playwrightは開発用で、ブラウザアプリの実行依存には含めない。開発依存の全ロック一覧はpackage-lock.jsonで参照できる。

`vendor/vision_bundle.js` はnpm配布の `vision_bundle.cjs` をclassic Workerで読み込むために拡張子のみ変更したものです。内容の変更はありません。`self.exports` への結果取得は自作Worker側で行います。`.js` とすることで静的サーバーがJavaScriptのMIMEを返す構成にします。

アセットは同じサイトに配置します。モデル・ライブラリの取得と、映像の外部送信は異なる処理です。本アプリには映像送信処理はありません。[MediaPipeの公式説明](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md)も入力データを端末で処理するとしています。
