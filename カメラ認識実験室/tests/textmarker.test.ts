import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homography,project,markerSVG,markerDictionary,CodeHistory,safeURL,originalPoint} from '../src/textmarker/geometry.ts';
import {parseText,textDefaults} from '../src/textmarker/settings.ts';
import {parseTextRecord} from '../src/textmarker/record.ts';
import {exportRecords,readRecords,type Experiment} from '../src/experiments.ts';
test('marker generator uses the pinned detector dictionary and validates all IDs',()=>{
 assert.equal(markerDictionary,'ARUCO_MIP_36h12');for(let i=0;i<250;i++){const s=markerSVG(i);assert.match(s,/viewBox="0 0 10 10"/);assert.match(s,/fill="black"/);}assert.throws(()=>markerSVG(-1));assert.throws(()=>markerSVG(250));assert.throws(()=>markerSVG(1.2));assert.notEqual(markerSVG(7),markerSVG(8));
});
test('projective quad preserves corners and handles rotation/scale/perspective',()=>{
 const q=[{x:.2,y:.1},{x:.8,y:.2},{x:.7,y:.9},{x:.1,y:.7}],h=homography(q);
 [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].forEach((p,i)=>{const v=project(h,p);assert.ok(Math.abs(v.x-q[i].x)<1e-9&&Math.abs(v.y-q[i].y)<1e-9);});assert.throws(()=>homography(new Array(4).fill({x:0,y:0})));
});
test('OCR crop and all four rotations map back to unmirrored original image',()=>{
 const c={x:.1,y:.2,w:.5,h:.6};assert.deepEqual(originalPoint({x:0,y:0},0,c),{x:.1,y:.2});assert.deepEqual(originalPoint({x:0,y:0},90,c),{x:.1,y:.8});assert.deepEqual(originalPoint({x:0,y:0},180,c),{x:.6,y:.8});assert.deepEqual(originalPoint({x:0,y:0},270,c),{x:.6,y:.2});
});
test('same code dedup groups reads and forgets old content without persistence',()=>{
 const h=new CodeHistory();assert.deepEqual(h.update('QR','secret',100),{count:1,fresh:true});assert.deepEqual(h.update('QR','secret',200),{count:2,fresh:false});assert.equal(h.update('EAN','secret',200).fresh,true);assert.deepEqual(h.update('QR','secret',11000),{count:1,fresh:true});
});
test('URL opening only accepts HTTP(S), never script/data schemes or credentials',()=>{
 assert.equal(safeURL('https://example.test/x'),'https://example.test/x');for(const s of ['javascript:alert(1)','data:text/html,test','https://u:p@example.test','not a url'])assert.equal(safeURL(s),null);
});
test('settings bound input load and OCR remains still, independent from old keys',()=>{
 assert.deepEqual(parseText('bad'),textDefaults);const s=parseText('{"tab":"ocr","input":"continuous","zoom":100,"cropX":100,"cropW":99,"ttl":999999}');assert.equal(s.input,'still');assert.equal(s.zoom,1);assert.equal(s.cropX,1);assert.equal(s.ttl,5000);assert.equal(parseText('{"tab":"marker","input":"continuous"}').input,'continuous');
});
test('records sanitize secret strings and image fields in JSON and CSV',()=>{
 const meta={kind:'ocr',language:'jpn+eng',count:4,features:0,matches:0,inliers:0,formats:[],text:'secret',image:'private',entities:[{text:'private'}]};assert.equal('text' in parseTextRecord(meta)!,false);
 const r:Experiment={version:'0.6.0',at:new Date().toISOString(),mode:'text',model:'tesseract',resolution:'640x480',renderFPS:null,inferenceFPS:null,averageMs:1,maximumMs:1,waitMs:200,loadMode:'auto',runtime:'Worker',userAgent:'test',language:'ja',platform:'test',cores:1,textLab:meta};
 for(const type of ['json','csv'] as const){const s=exportRecords([r],type);assert.ok(!s.includes('secret')&&!s.includes('private'));}assert.ok(readRecords(JSON.stringify([r]))[0].textLab);assert.equal(parseTextRecord({...meta,formats:['private text']}),undefined);
});
