# iPhoneセンサー実験室

iPhone Safariでカメラ、各種センサー、GPSマップトラッカーを確認するための静的Webアプリです。

## メニュー構成

- `index.html`: 実験メニュー
- `camera/`: カメラ実験
  - カメラ映像表示
  - 手指認識実験
- `sensor/`: センサー実験
  - 傾き・加速度
  - GPS
  - 画面の向き
  - 端末情報
- `map-tracker/`: GPSマップ実験
- `audio-diagnostics/`: 音声入出力確認ツール
- `torch-strobe/`: ライト・ストロボ実験
  - 背面カメラのTorch API対応・ON/OFF・連続点灯
  - 0.5〜60Hzのストロボ命令とJavaScript/API実行周期の測定
  - MediaRecorder録画と録画中のライト操作

## 使い方

1. `node server.js` を実行します。
2. iPhone Safariで `http://<PCのIPアドレス>:8123/` を開きます。
3. カメラやセンサーの権限を許可して実験します。

## 補足

- iPhone Safariでは `DeviceOrientationEvent` / `DeviceMotionEvent` の取得にユーザー操作が必要です。
- カメラや位置情報は安全なコンテキストでないと使えないことがあります。

## ライト・ストロボ実験の注意

- カメラとTorch APIの検証にはHTTPSが必須です。iPhone Safariで実機テストしてください。
- Torch APIとMediaRecorderの対応状況は端末・Safariのバージョンに依存します。
- 高速点滅への追従は保証されません。画面の実測値はJavaScriptとAPIの実行周期であり、LEDの物理的な点滅周期を保証するものではありません。
- 点滅する光を長時間直視せず、体調に異常を感じた場合は直ちに停止してください。
