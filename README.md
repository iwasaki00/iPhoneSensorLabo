# iPhone Sensor Lab

iPhone のブラウザでセンサー情報を確認するためのシンプルな静的 Web アプリです。

## 表示内容

- カメラ映像
- 傾き `alpha / beta / gamma`
- 加速度 `x / y / z`
- GPS 緯度・経度
- 画面の向き
- 追加: コンパス方位、位置精度、高度、速度、画面サイズ、UA

## 使い方

1. このディレクトリを静的サーバーで配信します。
2. iPhone Safari で HTTPS URL を開きます。
3. `まとめて開始` か各ボタンを押して権限を許可します。

## 補足

- iPhone Safari では `DeviceOrientationEvent` / `DeviceMotionEvent` の取得にユーザー操作が必要です。
- カメラや位置情報は安全なコンテキストでないと使えないことがあります。
