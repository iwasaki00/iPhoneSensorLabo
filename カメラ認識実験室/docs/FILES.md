# 作成ファイル一覧

## v0.5.0の追加・変更

- 新規ソース: `src/modes/multi.ts`、`src/multi/settings.ts`、`fusion.ts`、`presentation.ts`、`record.ts`
- 接続変更: `src/main.ts`、`src/modes/types.ts`、`src/settings.ts`、`src/render.ts`、`src/scene/panel.ts`、`src/experiments.ts`、`src/style.css`、`index.html`
- 配布・検証: package.json/lock、`scripts/check-menu.mjs`、`tests/multi.test.ts`、`tests/browser/multi.spec.ts`、再生成した `dist/`
- 資料: README、IPHONE_CHECKLIST、MODE_EXTENSION、EXPERIMENT_TEMPLATE、本一覧、`docs/V0_5_0.md`、`docs/performance-v0.5.0-{chrome,edge}.json`、`docs/v0.5.0-multi-synthetic.png`
- 親のindex.htmlとREADMEはカメラ実験室のVersion表記のみ変更。既存のモデル・WASM・風景内部調整コード・ライセンス条件・依存ライブラリの版は維持。

既存ファイルの一覧は以下のとおりです。

プロジェクトIDは `014_camera_vision_lab` です。ファイルは「カメラ認識実験室」直下に配置しています。旧 `014_camera_vision_lab/` フォルダは内容を移動して削除しました。親の `index.html` にメニューカードを追加し、親の `README.md` に配信先とビルド手順を追記しています。

```text
.gitignore
.gitattributes
package.json
package-lock.json
tsconfig.json
vite.config.ts
playwright.config.ts
index.html
README.md
THIRD_PARTY_NOTICES.md
src/env.d.ts
src/core.ts
src/main.ts
src/style.css
src/settings.ts
src/display.ts
src/render.ts
src/modes/types.ts
src/modes/object-detector.ts
src/modes/pixels.ts
src/modes/image-processing.ts
src/modes/processing-worker.ts
src/modes/session.ts
src/modes/segmenter.ts
src/segmentation/settings.ts
src/segmentation/models.ts
src/segmentation/composite.ts
src/segmentation/panel.ts
scripts/prepare-assets.mjs
scripts/check-static-site.mjs
scripts/check-menu.mjs
public/vision-worker.js
public/segmentation-worker.js
public/assets-manifest.json
public/models/efficientdet_lite0.tflite
public/models/selfie_segmenter.tflite
public/models/selfie_multiclass_256x256.tflite
public/vendor/vision_bundle.js
public/vendor/wasm/vision_wasm_internal.js
public/vendor/wasm/vision_wasm_internal.wasm
public/vendor/wasm/vision_wasm_nosimd_internal.js
public/vendor/wasm/vision_wasm_nosimd_internal.wasm
public/licenses/MediaPipe-APACHE-2.0.txt
public/licenses/EfficientDet-APACHE-2.0.txt
public/licenses/Segmentation-APACHE-2.0.txt
public/licenses/TypeScript-LICENSE.txt
public/licenses/Vite-LICENSE.md
public/licenses/Playwright-LICENSE.txt
public/licenses/THIRD_PARTY_NOTICES.md
tests/core.test.ts
tests/processing.test.ts
tests/segmentation.test.ts
tests/browser/camera.spec.ts
tests/browser/processing.spec.ts
tests/browser/segmentation.spec.ts
docs/IPHONE_CHECKLIST.md
docs/EXPERIMENT_TEMPLATE.md
docs/MODE_EXTENSION.md
docs/VERIFICATION.md
docs/FILES.md
docs/model-source-metadata.json
docs/pc-preview.png
docs/V0_2_0.md
docs/performance-v0.2.0.json
docs/v0.2.0-shape-split.png
docs/V0_3_0.md
docs/performance-v0.3.0-chrome.json
docs/performance-v0.3.0-edge.json
docs/v0.3.0-ui-synthetic.png
docs/v0.3.0-legacy-modes.png
```

このほか、ローカル実行用の `node_modules/`、ブラウザテストの `test-results/` を生成しています。これらは.gitignoreで除外しています。ビルド済み `dist/` は親メニューから静的配信するため、モデル・WASM・ライセンスを含めてGit管理対象としています。

v0.3.1の追加・直接変更: `src/core.ts`（FPS窓）、`src/main.ts`、`src/render.ts`、`src/style.css`、`src/segmentation/settings.ts`、`panel.ts`、`composite.ts`、新規 `stability.ts`、新規 `src/experiments.ts`、`index.html`、package.json/lock、ビルド済みdist。関連テストは新規 `tests/stability.test.ts`、`tests/mask-lifetime.test.ts`、`tests/browser/stability.spec.ts`、`tests/browser/performance.spec.ts`、記録先を更新した `tests/browser/segmentation.spec.ts`。資料はREADME、実機チェック、実験テンプレート、モード追加方針、本一覧、`docs/V0_3_1.md`、`docs/performance-v0.3.1-*.json`、`docs/v0.3.1-ui-synthetic.png`。親メニューと親READMEはカメラ実験室の版表記のみ更新しています。モデル・WASM・ライブラリの変更はありません。

v0.4.0の一覧は [変更・検証記録](V0_4_0.md) を参照。新規ソースは `src/scene/` と `src/modes/scene.ts`、新規テストは `tests/scene.test.ts`、`tests/browser/scene.spec.ts`。新規アセットは `public/models/scene/`、`public/vendor/tfjs-wasm/`、`public/scene-assets.json`、関連ライセンス。モデル選定は `docs/SCENE_MODELS.md`、全カテゴリは `docs/SCENE_CATEGORIES.md`、実測は `docs/performance-v0.4.0-*.json`、合成画像の表示例は `docs/v0.4.0-scene-synthetic.png`。既存テストのプレビュー画像も更新しています。ビルド済みdistはモデル・WASM・JSを含めて配布対象です。
