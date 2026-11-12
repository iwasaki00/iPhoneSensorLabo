# 風景認識モデルの選定・配布条件

確認日: 2026-11-12。採用した学習済み重みはTensorFlow公式DeepLab v3 / MobileNet-v2の量子化1byte、固定revision 1です。パッケージのライセンスだけで判断せず、配布元が**当該モデルvariationの学習済み重み**にApache 2.0を明示していることを確認しています。証跡は `public/licenses/DeepLab-weights-license-metadata.json`、原本の固定URLと全ファイルSHA-256は `public/scene-assets.json` に保存しています。配布元APIはvariationの現行version 2を列挙しますが、本アプリのダウンロードURLはrevision 1に固定し、実際の重み形式uint8も検証しています。

| 候補 | 判断 | 根拠・カテゴリ・負荷 |
| --- | --- | --- |
| TensorFlow.js DeepLab ADE20K | 初期モデルとして採用 | 背景を含む151出力、室内・屋外。空・道路・歩道・建物・壁・床・天井・家具を扱える。重み＋JSONは2,438,371 bytes（約2.33 MiB）。 |
| TensorFlow.js DeepLab Cityscapes | 順次比較用に採用 | 19出力、道路周辺。床・天井・家具の個別分類には未対応。重み＋JSONは2,237,643 bytes（約2.13 MiB）。標準の内部サイズが1025×2049と大きいため、後述の実験用サイズ調整を行う。 |
| MediaPipe DeepLab-v3（PASCAL VOC系） | 今回不採用 | 既存エンジンを再利用できるが、21出力は人物・動物・物体等が中心。空・道路・壁・床・天井の今回の比較には不足する。 |
| 浮動小数点版・2byte量子化版 | 今回不採用 | 初回転送を抑えるため1byte重みを採用。実行時はfloat32へ展開されるため、転送容量は実行メモリ量を意味しない。 |

## 実行とサイズ調整

`@tensorflow/tfjs-core`、`tfjs-converter`、`tfjs-backend-wasm`、`tfjs-backend-webgl`、`tfjs-backend-cpu` は4.22.0に固定。古い `@tensorflow-models/deeplab@0.2.2` ラッパーはTFJS 3系のpeer依存を要求するため実行依存に追加せず、その公開ラベル・配色定義だけを出典・ライセンス付きで保持します。GraphModelを直接実行し、元パッケージの固定513px前処理を使いません。

基本はmodule Worker内のWASM・1スレッドです。利用環境でWASMの初期化・演算に互換性がない場合は、WebGL、CPUの順に試します。Workerを使えない場合はメインスレッドで同じ順に試します。WebGLを無条件に必須とせず、実際に初期化と推論を試します。Safari実機でのGPU・Workerの組合せは未確認です。CPU互換方式では推論中にUIが止まる場合があります。

配布元のグラフはADE20Kが513×513、Cityscapesが1025×2049の固定リサイズ・グローバルプーリングを含みます。入力画像だけ縮小しても演算が十分軽くなりませんでした。本アプリは**実験用サイズ版**として、読込時のメモリ内コピーで以下だけを変更します。

- 4個の非学習int32サイズ定数（リサイズ先、パディング計算用上限、デコーダ／プーリング出力サイズ）。
- `AvgPool2D/AvgPool` のカーネルサイズ、およびCityscapesの同ノードのストライド。
- 既存の膨張畳み込み用パディングと整合するよう、入力設定160/257/384に対し内部サイズを161/257/385の正方形にする。

定数の名前、形、元の値、量子化形式とプーリング定義が固定revisionと一致しなければ停止します。学習済み畳み込みフィルタ・バイアスは変更せず、配布原本のモデルJSON・重みファイルも変更しません。処理は `src/scene/resize.ts`。元グラフと同じ精度を保証する構成ではなく、小さいサイズでは細い領域や小物の精度が低下します。これを標準解像度でのモデル評価値として扱わないでください。画面と記録に内部サイズを含めます。

初回読込・推論・Tensor数のPC実測は [v0.4.0検証記録](V0_4_0.md) に記載します。iPhoneの読込時間・推論時間は未測定です。転送量とは別に、WASMヒープ、JSのグラフ・画像・マスク、バックエンドの一時領域が必要です。`tf.memory()`はTensorの管理量であり、端末全体のメモリ使用量ではありません。

## ライセンス・再配布

採用した両モデルvariation、TensorFlow.js、公開ラベル／配色定義はApache-2.0。ローカルサイトへのモデル再配布ではライセンス・帰属表示と変更説明を保持します。seedrandom 3.0.5はMIT、long 4.0.0はApache-2.0で、本文・著作権表示を `public/licenses/` に同梱します。全依存はpackage-lock.jsonで固定します。

配色は公式定義を基にし、ADE20Kで道路と同色だったID 49（skyscraper）の表示色だけ白へ変更しました。元定義はそのまま同梱し、変更は `src/scene/models.ts` の表示用配色で行います。全カテゴリの配色が重複しないことをテストしています。

ADE20K／Cityscapesの**学習データセット画像の条件はモデルの配布ライセンスと別**です。データセット画像は同梱・再配布せず、テストには自作の合成画像を使います。将来データセットでの学習や画像再配布を行う場合には、その利用条件を別途確認してください。

一次資料:

- [TensorFlow公式モデルカード（ADE20K）](https://www.kaggle.com/models/tensorflow/deeplab/TfJs/ade20k-1-quantized/1)、[Cityscapes](https://www.kaggle.com/models/tensorflow/deeplab/TfJs/cityscapes-1-quantized/1)
- [配布元のモデル・ライセンス公開API](https://www.kaggle.com/api/v1/models/list?search=deeplab)
- [公式DeepLabラッパー・カテゴリ定義](https://github.com/tensorflow/tfjs-models/tree/master/deeplab)、[元チェックポイントのModel Zoo](https://github.com/tensorflow/models/blob/master/research/deeplab/g3doc/model_zoo.md)
- [TensorFlow.jsの実行方式とメモリ管理](https://www.tensorflow.org/js/guide/platform_environment)、[MediaPipe Image Segmenterの対応モデル](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter)
- [ADE20Kのデータセット条件](https://ade20k.csail.mit.edu/terms/)、[Cityscapesのデータセット条件](https://www.cityscapes-dataset.com/license/)
