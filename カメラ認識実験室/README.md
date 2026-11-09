# Camera Vision Lab — 014_camera_vision_lab

Version **0.1.0 / OBJECT DETECTION FOUNDATION**。iPhone Safariを優先した、端末内で物体認識を行う実験ツールです。ゲーム機能はありません。

## 起動

Node.js 22.18以上（検証環境25.9.0）、npmを使用します。

```sh
cd カメラ認識実験室
npm ci
npm run assets
npm run dev
```

PCは表示された `http://localhost:5173` を開きます。iPhoneからPCのHTTP LANアドレスを開くとカメラを使用できません。iPhoneには**信頼された証明書でのHTTPS配信**が必要です。[実機手順](docs/IPHONE_CHECKLIST.md)を参照してください。

```sh
npm test
npm run build
npm run preview
npx playwright test
```

最後のコマンドはPCにインストール済みのChromeと模擬カメラを使用する関連ブラウザテストです。実カメラの認識精度を保証するものではありません。

## 操作

1. 下部の「カメラを起動」を押してカメラの使用を許可します。
2. モデル読込後、位置・日本語名・信頼度を映像上に表示します。未登録名は英語のまま表示します。最大20件です。
3. 「前面に切替／背面に切替」でカメラを切り替えます。前面映像と認識枠は鏡像表示です。端末が指定方向を提供しない場合はブラウザが選んだカメラとなります。診断のカメラ設定で確認できます。
4. 「認識 ON／OFF」は認識のみを切り替えます。OFF中も映像を表示します。
5. 「詳細設定」で信頼度（10〜95%）、解析長辺（320/480/640px）、推論完了後の待機時間（100/200/500ms）を変更できます。
6. 「カメラを停止」で全Track、Worker、モデルを解放します。画面のバックグラウンド移行でも停止します。復帰後は手動で再起動します。
7. エラー時は案内に従い「停止して再試行」を押します。モデル取得失敗時はモデル・WASMが配置されているか確認してください。

カメラ表示FPSは `requestVideoFrameCallback` で実際に通知された映像フレーム数を計測します。API非対応環境では「—」です。認識FPSは推論完了回数を別に計測します。両者とも直近2秒のイベント間隔から算出し、2サンプル未満は「—」です。推論msは直近の `detectForVideo` 呼出時間で、画像準備・Worker転送・待機時間を含みません。推論が遅れるほど描画も遅れる互換方式では、FPS低下を隠しません。認識枠は2秒で失効します。数字は性能目標や推定値ではありません。

## 構成と採用理由

Vite + TypeScriptを採用。静的ファイルへビルドでき、型を持つ共通インターフェースと依存固定を簡潔に管理できます。UIフレームワークは追加していません。

- `src/core.ts`: カメラのライフサイクル、結果変換、座標変換、エラー、計測
- `src/modes/types.ts`: モード共通インターフェース
- `src/modes/object-detector.ts`: Worker優先／CPU互換方式と解放
- `public/vision-worker.js`: classic Worker上の直列推論
- `src/main.ts`: UI、描画ループ、単一推論ループ
- `public/models`, `public/vendor`: 固定モデルとJS/WASM実行アセット
- `public/assets-manifest.json`: 配布元、バージョン、サイズ、SHA-256
- `scripts/prepare-assets.mjs`: アセット準備・ハッシュ検証
- `tests/`: 変更に直接関連する単体・ブラウザテスト

WorkerとImageBitmap/OffscreenCanvasを優先します。非対応・初期化失敗・Worker推論失敗時はCPUによるメインスレッド推論へ切り替えます。互換方式は同期APIのためUIが一時的に止まることがあります。WASMのSIMD選択はMediaPipe Resolverが行い、両方のWASMを同梱します。最初の推論が完了するまで互換性は確定しません。

## プライバシーと配布

実行時のモデル・WASM取得は同じサイトへのGET通信です。カメラ映像の送信・保存、解析・広告・遠隔推論SDKはありません。CSPで接続先を同一オリジンに制限します。ビルド時のnpmとアセット取得にはインターネット接続が必要です。実行時に外部CDNへアクセスしません。サービスワーカーは導入しておらず、オフライン初回起動は保証しません。

`npm run build` の `dist/` が静的配布物です。相対baseによりGitHub Pagesのサブディレクトリ配置を想定しています。モデル・WASM・licensesを含めて配布します。この作業ではGit初期化、push、公開を行っていません。

ソースは「iPhoneセンサー実験室/カメラ認識実験室」直下に配置しています。親の実験メニューは `カメラ認識実験室/dist/` を開きます。変更後はこのフォルダで `npm run build` を実行してから親メニューで確認してください。親フォルダの `node server.js` でPCから確認する場合は `http://localhost:8123/` を開きます。iPhoneのカメラ利用にはHTTPS配信が必要です。

詳細は [ライセンス一覧](THIRD_PARTY_NOTICES.md)、[実機確認](docs/IPHONE_CHECKLIST.md)、[実験記録](docs/EXPERIMENT_TEMPLATE.md)、[モード追加方針](docs/MODE_EXTENSION.md)、[検証結果](docs/VERIFICATION.md)を参照してください。
