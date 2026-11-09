export type Box = { x: number; y: number; width: number; height: number };
export type Observation = { box: Box; label: string; score: number };
export type RawDetection = { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: { categoryName: string; score: number }[] };
const names: Record<string, string> = {
  person:'人', bicycle:'自転車', car:'車', motorcycle:'バイク', airplane:'飛行機', bus:'バス', train:'電車', truck:'トラック', boat:'船',
  'traffic light':'信号機', 'fire hydrant':'消火栓', 'stop sign':'一時停止標識', 'parking meter':'パーキングメーター', bench:'ベンチ',
  bird:'鳥', cat:'猫', dog:'犬', horse:'馬', sheep:'羊', cow:'牛', elephant:'象', bear:'熊', zebra:'シマウマ', giraffe:'キリン',
  backpack:'リュック', umbrella:'傘', handbag:'ハンドバッグ', tie:'ネクタイ', suitcase:'スーツケース', frisbee:'フリスビー', skis:'スキー', snowboard:'スノーボード',
  'sports ball':'ボール', kite:'凧', 'baseball bat':'野球バット', 'baseball glove':'野球グローブ', skateboard:'スケートボード', surfboard:'サーフボード', 'tennis racket':'テニスラケット',
  bottle:'ボトル', 'wine glass':'ワイングラス', cup:'カップ', fork:'フォーク', knife:'ナイフ', spoon:'スプーン', bowl:'ボウル', banana:'バナナ', apple:'りんご', sandwich:'サンドイッチ', orange:'オレンジ', broccoli:'ブロッコリー', carrot:'にんじん', 'hot dog':'ホットドッグ', pizza:'ピザ', donut:'ドーナツ', cake:'ケーキ',
  chair:'椅子', couch:'ソファ', 'potted plant':'鉢植え', bed:'ベッド', 'dining table':'テーブル', toilet:'トイレ', tv:'テレビ', laptop:'ノートPC', mouse:'マウス', remote:'リモコン', keyboard:'キーボード', 'cell phone':'携帯電話', microwave:'電子レンジ', oven:'オーブン', toaster:'トースター', sink:'流し台', refrigerator:'冷蔵庫', book:'本', clock:'時計', vase:'花瓶', scissors:'はさみ', 'teddy bear':'ぬいぐるみ', 'hair drier':'ドライヤー', toothbrush:'歯ブラシ'
};
export function convert(detections: RawDetection[], threshold: number): Observation[] {
  return detections.flatMap(d => {
    const c = d.categories.reduce<(typeof d.categories)[number] | undefined>((best, v) => !best || v.score > best.score ? v : best, undefined);
    const b = d.boundingBox;
    if (!c || !b || !Number.isFinite(c.score) || c.score < threshold || ![b.originX,b.originY,b.width,b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) return [];
    return [{ label: names[c.categoryName] ?? c.categoryName, score: c.score, box: { x:b.originX,y:b.originY,width:b.width,height:b.height } }];
  });
}
export function containBox(b: Box, sw: number, sh: number, dw: number, dh: number, mirror = false): Box {
  const scale = Math.min(dw / sw, dh / sh);
  return { x:(dw-sw*scale)/2+(mirror ? sw-b.x-b.width : b.x)*scale, y:(dh-sh*scale)/2+b.y*scale, width:b.width*scale,height:b.height*scale };
}
export function errorMessage(error: unknown): string {
  const name = (error as {name?:string})?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'カメラが許可されていません。Safariのサイト設定でカメラを許可し、再試行してください。';
  if (name === 'NotFoundError') return 'カメラが見つかりません。接続と端末設定を確認してください。';
  if (name === 'NotReadableError' || name === 'AbortError') return 'カメラを使用できません。他のアプリを閉じて再試行してください。';
  if (name === 'OverconstrainedError') return '指定のカメラ設定を使用できません。カメラを切り替えて再試行してください。';
  return error instanceof Error ? error.message : '処理に失敗しました。停止して再試行してください。';
}
export class Camera {
  private stream?: MediaStream;
  private generation = 0;
  private video: HTMLVideoElement;
  private getMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  constructor(video: HTMLVideoElement, getMedia = (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c)) { this.video=video;this.getMedia=getMedia; }
  async start(facing: 'user' | 'environment', ended: () => void) {
    this.stop();
    const generation = this.generation;
    const portrait=typeof window!=='undefined'&&window.innerHeight>window.innerWidth;
    const stream = await this.getMedia({ audio:false, video:{ facingMode:{ideal:facing}, width:{ideal:portrait?720:1280},height:{ideal:portrait?1280:720} } });
    if (generation !== this.generation) { stream.getTracks().forEach(t=>t.stop()); return false; }
    this.stream = stream;
    this.video.srcObject = stream;
    stream.getVideoTracks().forEach(t=>t.addEventListener('ended', ended, {once:true}));
    try { await this.video.play(); } catch (e) { if(generation!==this.generation)return false;this.stop();throw e; }
    if (generation !== this.generation) return false;
    return true;
  }
  stop() { this.generation++; this.stream?.getTracks().forEach(t=>t.stop()); this.stream=undefined; this.video.pause(); this.video.srcObject=null; }
  settings() { return this.stream?.getVideoTracks()[0]?.getSettings(); }
}
export class Rate {
  private times: number[] = [];
  tick(now: number) { this.times.push(now); this.times=this.times.filter(t=>t>=now-2000); }
  value(now: number) { this.times=this.times.filter(t=>t>=now-2000); return this.times.length<2 ? null : (this.times.length-1)*1000/(this.times.at(-1)!-this.times[0]); }
  reset() { this.times=[]; }
}
