export type TextRecord = { kind:string;language:string;count:number;features:number;matches:number;inliers:number;formats:string[] };
export function parseTextRecord(v:any):TextRecord|undefined {
  if(!v||!['ocr','code','match','marker','overlay'].includes(v.kind)||!['eng','jpn','jpn+eng'].includes(v.language)||!['count','features','matches','inliers'].every(k=>Number.isInteger(v[k])&&v[k]>=0&&v[k]<=100000)||!Array.isArray(v.formats)||v.formats.length>32||!v.formats.every((f:unknown)=>typeof f==='string'&&/^[A-Z0-9_]{1,40}$/.test(f)))return;
  return {kind:v.kind,language:v.language,count:v.count,features:v.features,matches:v.matches,inliers:v.inliers,formats:[...v.formats]};
}
