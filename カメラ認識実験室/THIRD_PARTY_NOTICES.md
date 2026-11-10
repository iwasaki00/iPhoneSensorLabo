# 採用ライブラリ・モデル・配布条件

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

## 配布時に保持するもの

- Apache-2.0の本文、上流の著作権・帰属表示を保持する。変更した上流ファイルには変更を明示する。上流がNOTICEを提供する場合はその帰属表示も保持する。
- MITの著作権表示・許諾文を保持する。
- `public/licenses/`、`THIRD_PARTY_NOTICES.md`、`public/assets-manifest.json` を保持する。準備スクリプトは一覧のコピーも `public/licenses/` に配置する。
- Vite、TypeScript、Playwrightは開発用で、ブラウザアプリの実行依存には含めない。開発依存の全ロック一覧はpackage-lock.jsonで参照できる。

`vendor/vision_bundle.js` はnpm配布の `vision_bundle.cjs` をclassic Workerで読み込むために拡張子のみ変更したものです。内容の変更はありません。`self.exports` への結果取得は自作Worker側で行います。`.js` とすることで静的サーバーがJavaScriptのMIMEを返す構成にします。

アセットは同じサイトに配置します。モデル・ライブラリの取得と、映像の外部送信は異なる処理です。本アプリには映像送信処理はありません。[MediaPipeの公式説明](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md)も入力データを端末で処理するとしています。
