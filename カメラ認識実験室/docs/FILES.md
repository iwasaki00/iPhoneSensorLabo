# 作成ファイル一覧

プロジェクトIDは `014_camera_vision_lab` です。ファイルは「カメラ認識実験室」直下に配置しています。旧 `014_camera_vision_lab/` フォルダは内容を移動して削除しました。親の `index.html` にメニューカードを追加し、親の `README.md` に配信先とビルド手順を追記しています。

```text
.gitignore
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
src/modes/types.ts
src/modes/object-detector.ts
scripts/prepare-assets.mjs
scripts/check-static-site.mjs
public/vision-worker.js
public/assets-manifest.json
public/models/efficientdet_lite0.tflite
public/vendor/vision_bundle.js
public/vendor/wasm/vision_wasm_internal.js
public/vendor/wasm/vision_wasm_internal.wasm
public/vendor/wasm/vision_wasm_nosimd_internal.js
public/vendor/wasm/vision_wasm_nosimd_internal.wasm
public/licenses/MediaPipe-APACHE-2.0.txt
public/licenses/EfficientDet-APACHE-2.0.txt
public/licenses/TypeScript-LICENSE.txt
public/licenses/Vite-LICENSE.md
public/licenses/Playwright-LICENSE.txt
public/licenses/THIRD_PARTY_NOTICES.md
tests/core.test.ts
tests/browser/camera.spec.ts
docs/IPHONE_CHECKLIST.md
docs/EXPERIMENT_TEMPLATE.md
docs/MODE_EXTENSION.md
docs/VERIFICATION.md
docs/FILES.md
docs/model-source-metadata.json
docs/pc-preview.png
```

このほか、ローカル実行用の `node_modules/`、ブラウザテストの `test-results/` を生成しています。これらは.gitignoreで除外しています。ビルド済み `dist/` は親メニューから静的配信するため、モデル・WASM・ライセンスを含めてGit管理対象としています。
