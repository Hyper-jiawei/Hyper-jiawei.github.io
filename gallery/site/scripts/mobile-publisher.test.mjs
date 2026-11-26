import assert from 'node:assert/strict';
import {test} from 'node:test';
import exifr from 'exifr';
import {configFor,validate,storage,PHOTO_LIMIT,ALBUM_LIMIT,enableHeicBrands,readPhotoDate,selectedFiles,publicationFor} from '../public/publish/core.mjs';
const album={title:'手机一辑',slug:'2026-11-02-phone',date:'2026-11-02',categories:[],description:''};
const photo=()=>({file:'一张.HEIC',blob:new Blob(['camera original']),description:'',cover:true});
test('mobile config omits unselected featured, permits empty descriptions, and validates renamed files',()=>{
  assert.ok(!configFor(album,[photo()]).includes('featured:'));
  assert.ok(configFor(album,[{...photo(),featured:true}]).includes('featured: true'));
  assert.throws(()=>validate({...album,date:'2026-02-30'},[photo()]));
  assert.throws(()=>validate(album,[photo(),{...photo(),cover:false}]));
  assert.throws(()=>validate(album,[{...photo(),file:'../secret.jpg'}]));
});
test('single publish uses the photo filename, preserves its description and supports unknown dates',()=>{
  const p={...photo(),file:'上海之巅看上海.HEIC',description:'黄浦江',date:'2025-08-01'};
  const single=selectedFiles('single',[new File(['original'],p.file)]);
  const entry=publicationFor(single,[p]);
  assert.equal(entry.title,'上海之巅看上海');
  assert.equal(entry.slug,'2025-08-01-上海之巅看上海');
  const config=configFor({...entry,description:p.description},[p]);
  assert.match(config,/date: "2025-08-01"/);
  assert.match(config,/"layout": "single-big-photo"/);
  assert.match(config,/"captureDate": "2025-08-01"/);
  assert.equal(config.match(/description: "黄浦江"/g).length,2);
  assert.match(configFor(publicationFor(single,[{...p,date:''}]),[p]),/date: ""/);
  assert.throws(()=>selectedFiles('single',[...single.files,...single.files]),/一张/);
});

test('folder selection keeps the folder name, ignores subfolders and prefers an explicit folder date',()=>{
  const inFolder=(name,root='2026_11_22_青浦一角',prefix='')=>({name,webkitRelativePath:`${root}/${prefix}${name}`});
  const selection=selectedFiles('folder',[inFolder('10.HEIC'),inFolder('.DS_Store'),inFolder('2.jpg'),inFolder('嵌套.jpg',undefined,'nested/')]);
  assert.deepEqual(selection.files.map(f=>f.name),['2.jpg','10.HEIC']);
  const p=[{file:'2.jpg',date:'2026-11-24'},{file:'10.HEIC',date:'2026-11-23'}];
  const entry=publicationFor(selection,p);
  assert.equal(entry.title,'2026_11_22_青浦一角');
  assert.equal(entry.date,'2026-11-22');
  assert.equal(entry.dateSource,'folder');
  assert.equal(entry.metadata,undefined);
  assert.equal(publicationFor({...selection,folderName:'iPhoneDuo'},p).slug,'iPhoneDuo');
  for(const folderName of ['青浦一角','2026_02_30_青浦一角','未完成 202611']) {
    assert.equal(publicationFor({...selection,folderName},p).date,'2026-11-23');
  }
  assert.equal(publicationFor({...selection,folderName:'20261122 青浦'},p).date,'2026-11-22');
  assert.equal(publicationFor(selectedFiles('album',[{name:'2.jpg'},{name:'说明.txt'}]),p).title,'2 · 专辑');
  assert.throws(()=>selectedFiles('folder',[inFolder('嵌套.jpg',undefined,'nested/')]),/顶层/);
});

test('capture date prefers original EXIF, falls back to EXIF creation, and never uses lastModified',async()=>{
  const file=new File(['original'],'image.jpg',{lastModified:Date.UTC(2026,10,25)});
  assert.equal(await readPhotoDate(file,async()=>({DateTimeOriginal:'2025:08:01 23:59:59',CreateDate:'2025:09:07 01:00:00'})),'2025-08-01');
  assert.equal(await readPhotoDate(file,async()=>({DateTimeOriginal:'0000:00:00 00:00:00',CreateDate:'2025-09-07T23:59:59-07:00'})),'2025-09-07');
  assert.equal(await readPhotoDate(file,async()=>({ModifyDate:'2026:11:25 14:34:00'})),'');
  assert.equal(await readPhotoDate(file,exifr.parse),'');
});

test('reads WebP embedded EXIF without using file timestamps',async()=>{
  const tiff=Buffer.alloc(70);
  tiff.write('II',0);tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
  tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x8769,10);tiff.writeUInt16LE(4,12);tiff.writeUInt32LE(1,14);tiff.writeUInt16LE(26,18);
  tiff.writeUInt16LE(1,26);tiff.writeUInt16LE(0x9003,28);tiff.writeUInt16LE(2,30);tiff.writeUInt32LE(20,32);tiff.writeUInt32LE(44,36);
  tiff.write('2025:08:01 12:10:50\0',44);
  const webp=Buffer.alloc(20);
  webp.write('RIFF',0);webp.writeUInt32LE(12+tiff.length,4);webp.write('WEBPEXIF',8);webp.writeUInt32LE(tiff.length,16);
  const original=new File([webp,tiff],'image.webp',{lastModified:Date.UTC(2026,10,25)});
  assert.equal(await readPhotoDate(original,async(blob,options)=>exifr.parse(Buffer.from(await blob.arrayBuffer()),options)),'2025-08-01');
});

test('accepts the longer ftyp header used by newer iPhone HEIC originals',()=>{
  const parser=exifr.fileParsers.get('heic');
  const bytes=Buffer.alloc(64);bytes.writeUInt32BE(52);bytes.write('ftypheic',4);
  const input={byteLength:bytes.length,getUint32:offset=>bytes.readUInt32BE(offset),getUint16:offset=>bytes.readUInt16BE(offset),getString:(offset,len)=>bytes.toString('ascii',offset,offset+len)};
  assert.equal(parser.canHandle(input,0),false);
  enableHeicBrands(exifr.fileParsers);
  assert.equal(parser.canHandle(input,0),true);
  bytes.write('qt  ',8);
  assert.equal(parser.canHandle(input,0),false);
});

test('size limits match the Worker free-tier request budget',()=>{
  assert.equal(PHOTO_LIMIT,95*1024**2);
  assert.equal(ALBUM_LIMIT,1024**3);
  assert.throws(()=>validate(album,[{...photo(),blob:undefined,remote:{size:PHOTO_LIMIT+1,etag:'"a"'}}]),/95 MiB/);
});

test('the token only travels to the same-origin /api proxy, with the right content type per body',async()=>{
  const calls=[];
  const request=async(url,opts)=>{calls.push({url,opts});return new Response('{}');};
  const api=storage('never-store-secret',request);
  await api('GET','/albums');
  await api('PUT','/albums/t/a.jpg',new Blob(['bytes'],{type:'image/heic'}));
  await api('PUT','/albums/t','---\n---\n',{'If-Match':'"etag"'});
  await api('DELETE','/albums/t',null,{'If-Match':'"etag"'});
  assert.deepEqual(calls.map(c=>c.url),['/api/albums','/api/albums/t/a.jpg','/api/albums/t','/api/albums/t']);
  assert.ok(calls.every(c=>c.opts.headers.Authorization==='Bearer never-store-secret'));
  assert.equal(calls[1].opts.headers['Content-Type'],'image/heic');
  assert.equal(calls[2].opts.headers['Content-Type'],'text/plain;charset=utf-8');
  assert.equal(calls[2].opts.headers['If-Match'],'"etag"');
  assert.ok(!('body' in calls[3].opts));
});

test('rejected requests map to actionable Chinese errors without exposing the token',async()=>{
  const reply=status=>async()=>new Response(JSON.stringify({message:'denied'}),{status});
  await assert.rejects(storage('secret',reply(401))('GET','/albums'),error=>/denied（401）/.test(error.message)&&/发布令牌/.test(error.message)&&error.status===401&&!error.message.includes('secret'));
  await assert.rejects(storage('secret',reply(409))('PUT','/albums/t'),error=>/刷新后重试/.test(error.message)&&error.status===409);
  await assert.rejects(storage('secret',reply(500))('GET','/albums'),error=>/已上传的原图不会丢失/.test(error.message)&&error.status===500);
  const noContent=await storage('secret',async()=>new Response(null,{status:204}))('DELETE','/albums/t');
  assert.equal(noContent,null);
});

test('mobile and Mac generate the same configuration format',async()=>{const fs=await import('node:fs/promises');assert.equal(await fs.readFile(new URL('../public/publish/config.mjs',import.meta.url),'utf8'),await fs.readFile(new URL('../../../tools/gallery-publisher/config.mjs',import.meta.url),'utf8'));});