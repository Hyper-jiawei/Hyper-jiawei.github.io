import assert from 'node:assert/strict';
import {test} from 'node:test';
import exifr from 'exifr';
import {configFor,validate,blobSha,base64,github,chooseArchive,commitFiles,publish,MAIN,MAIN_BUDGET,settingsFor,checkRepository,enableHeicBrands,readPhotoDate,selectedFiles,publicationFor} from '../public/publish/core.mjs';
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
  tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x8769,10);tiff.writeUInt16LE(4,12);tiff.writeUInt32LE(1,14);tiff.writeUInt32LE(26,18);
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

test('browser encodes original bytes losslessly and hashes Git blobs correctly',async()=>{
  assert.equal(await base64(new Blob(['中文 HEIC'])) ,Buffer.from('中文 HEIC').toString('base64'));
  const crypto=await import('node:crypto');const b=Buffer.from('camera original');
  assert.equal(await blobSha(photo().blob),crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'));
});
test('token only goes to GitHub API and rejected requests do not expose it',async()=>{
  let request;const api=github('never-store-secret',async(url,opts)=>{request={url,opts};return {ok:false,status:403,json:async()=>({message:'No access'})};});
  await assert.rejects(api('GET','/user'),/GitHub 403/);
  assert.equal(request.url,'https://api.github.com/user');assert.equal(request.opts.headers.Authorization,'Bearer never-store-secret');
});
test('mobile archive allocator uses public repositories and skips private/full ones',async()=>{
  const created=[];const repo=(name,priv,size)=>({name,private:priv,size,full_name:'Hyper-jiawei/'+name,default_branch:'main',owner:{login:'Hyper-jiawei'}});
  const api=async(method,path,body)=>{
    if(method==='GET'&&path.startsWith('/user/repos'))return [repo('gallery01',false,900*1024),repo('gallery02',true,1)];
    if(path==='/user')return {login:'Hyper-jiawei',type:'User'};
    if(method==='GET')return repo('gallery03',false,0);
    if(path==='/user/repos'){created.push(body);return repo(body.name,false,0);}
    return {sha:'probe'};
  };
  assert.equal((await chooseArchive(api,100)).repo,'Hyper-jiawei/gallery03');assert.equal(created[0].private,false);
});
function fake(tree=[]) {
  const calls=[], commits=[],blobs=new Map();let n=0;
  const api=async(method,path,body)=>{
    calls.push({method,path,body});
    if(path==='/user')return {login:'Hyper-jiawei',type:'User'};
    if(method==='GET'&&/^\/repos\/[^/]+\/[^/]+$/.test(path))return {full_name:path.slice(7),default_branch:'main',private:false,size:0,permissions:{push:true}};
    if(path.startsWith('/user/repos')) return [{name:'gallery01',private:false,size:0,full_name:'Hyper-jiawei/gallery01',default_branch:'main',owner:{login:'Hyper-jiawei'}}];
    if(path.includes('/git/ref/'))return {object:{sha:'head'}};
    if(method==='GET' && path.includes('/git/commits/'))return {tree:{sha:'tree'}};
    if(method==='GET' && path.includes('/git/trees/'))return {tree:path.includes(MAIN)?tree:[],truncated:false};
    if(path.endsWith('/git/blobs')){const data=new Blob([Buffer.from(body.content,body.encoding==='base64'?'base64':'utf8')]),sha=await blobSha(data);blobs.set(sha,await data.text());return {sha};}
    if(path.endsWith('/git/trees'))return {sha:'newtree'};
    if(path.endsWith('/git/commits')){const commit={sha:String(++n).padStart(40,'a')};commits.push(commit);return commit;}
    if(method==='PATCH')return {};
    throw Error(path);
  };return {api,calls,blobs};
}
test('phone publishing is one atomic album commit and never touches other albums',async()=>{
  const f=fake([{path:'gallery/content/other/原图.jpg',type:'blob',size:3,sha:'old'}]);
  await publish(f.api,album,[photo()],false);
  const change=f.calls.find(c=>c.method==='POST'&&c.path.endsWith('/git/trees')).body;
  assert.equal(change.base_tree,'tree');assert.equal(change.tree.length,2);assert.ok(change.tree.every(e=>e.path.startsWith('gallery/content/'+album.slug+'/')));
  assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
});
test('large phone albums split originals into archive and publish only config and pinned sources in main',async()=>{
  const f=fake([{path:'gallery/content/old/big.jpg',type:'blob',size:MAIN_BUDGET,sha:'old'}]);
  const result=await publish(f.api,album,[photo()],false);
  assert.equal(result.archive,'Hyper-jiawei/gallery01');
  const changes=f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/git/trees'));
  assert.ok(changes[0].path.includes('gallery01'));
  assert.deepEqual(changes[1].body.tree.map(e=>e.path.split('/').pop()).sort(),['_sources.json','index.md']);
  const sources=JSON.parse(f.blobs.get(changes[1].body.tree.find(e=>e.path.endsWith('_sources.json')).sha));
  assert.equal(sources.files[0].sha,await blobSha(photo().blob));assert.match(sources.commit,/^[a-f0-9]{40}$/);
});
test('concurrent remote change prevents branch update and deletion stays scoped',async()=>{
  const f=fake();const api=async(method,path,body)=>method==='GET'&&path.includes('/git/ref/')?{object:{sha:'changed'}}:f.api(method,path,body);
  await assert.rejects(commitFiles(api,MAIN,'main',{sha:'head',treeSha:'tree',tree:[]},[{name:'index.md',blob:new Blob(['new'])}],'gallery/content/a/'),/远端有新提交/);
  assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
});

test('mobile and Mac generate the same configuration format',async()=>{const fs=await import('node:fs/promises');assert.equal(await fs.readFile(new URL('../public/publish/config.mjs',import.meta.url),'utf8'),await fs.readFile(new URL('../../../tools/gallery-publisher/config.mjs',import.meta.url),'utf8'));});

test('a different account can publish to a chosen repo, branch and path',async()=>{
  const f=fake(), settings={repository:'Someone/portfolio',branch:'photos',contentPath:'albums',archivePrefix:'work'};
  const result=await publish(f.api,album,[photo()],false,()=>{},settings);
  assert.equal(result.repository,'Someone/portfolio');assert.equal(result.branch,'photos');
  const tree=f.calls.find(c=>c.method==='POST'&&c.path.endsWith('/git/trees'));
  assert.ok(tree.path.includes('/repos/Someone/portfolio/'));assert.ok(tree.body.tree.every(e=>e.path.startsWith('albums/'+album.slug+'/')));
  assert.ok(f.calls.some(c=>c.method==='PATCH'&&c.path.endsWith('/heads/photos')));
});
test('explicit public archive supports arbitrary name and writes a portable source path',async()=>{
  const f=fake();const result=await publish(f.api,album,[photo()],false,()=>{},{repository:'Someone/portfolio',contentPath:'pictures',archiveRepository:'Someone/original-photos'});
  assert.equal(result.archive,'Someone/original-photos');
  const trees=f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/git/trees'));
  const sources=JSON.parse(f.blobs.get(trees[1].body.tree.find(e=>e.path.endsWith('_sources.json')).sha));
  assert.equal(sources.repository,'Someone/original-photos');assert.equal(sources.path,'pictures/'+album.slug+'/');
});
test('preflight rejects a readable repository when the token cannot create blobs',async()=>{
  const calls=[];const api=async(method,path)=>{calls.push({method,path});if(method==='GET')return {permissions:{push:true},default_branch:'main'};throw Error('Contents: Read and write required');};
  await assert.rejects(publish(api,album,[photo()],false),/Contents/);assert.equal(calls.length,2);
});
test('paths cannot escape their album scope and source archive must differ from target',()=>{
  for(const contentPath of ['../escape','gallery/../other','gallery//content','folder?x'])assert.throws(()=>settingsFor({contentPath}));
  assert.throws(()=>settingsFor({archiveRepository:MAIN}));
});
test('custom numbered archive creation supports organization accounts',async()=>{
  const created=[];const api=async(method,path,body)=>{
    if(path.startsWith('/user/repos?'))return [{owner:{login:'Studio'},name:'work09',full_name:'Studio/work09',private:false,size:9999999}];
    if(path==='/user')return {login:'Someone',type:'User'};
    if(path==='/users/Studio')return {login:'Studio',type:'Organization'};
    if(method==='POST'&&path==='/orgs/Studio/repos'){created.push(body);return {full_name:'Studio/work10',private:false,default_branch:'main'};}
    if(method==='GET')return {full_name:'Studio/work10',private:false,permissions:{push:true},default_branch:'main'};
    return {sha:'probe'};
  };
  const archive=await chooseArchive(api,1,{repository:'Studio/site',archivePrefix:'work'});
  assert.equal(archive.repo,'Studio/work10');assert.equal(created[0].name,'work10');assert.equal(created[0].private,false);
});
