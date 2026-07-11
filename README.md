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

## 使い方

1. `node server.js` を実行します。
2. iPhone Safariで `http://<PCのIPアドレス>:8123/` を開きます。
3. カメラやセンサーの権限を許可して実験します。

## 補足

- iPhone Safariでは `DeviceOrientationEvent` / `DeviceMotionEvent` の取得にユーザー操作が必要です。
- カメラや位置情報は安全なコンテキストでないと使えないことがあります。
