import assert from 'node:assert/strict';
import {test} from 'node:test';
import {configFor,validate,blobSha,base64,github,chooseArchive,commitFiles,publish,MAIN,MAIN_BUDGET} from '../public/publish/core.mjs';
const album={title:'手机一辑',slug:'2026-11-02-phone',date:'2026-11-02',categories:[],description:''};
const photo=()=>({file:'一张.HEIC',blob:new Blob(['camera original']),description:'',cover:true});
test('mobile config omits unselected featured, permits empty descriptions, and validates renamed files',()=>{
  assert.ok(!configFor(album,[photo()]).includes('featured:'));
  assert.ok(configFor(album,[{...photo(),featured:true}]).includes('featured: true'));
  assert.throws(()=>validate({...album,date:'2026-02-30'},[photo()]));
  assert.throws(()=>validate(album,[photo(),{...photo(),cover:false}]));
  assert.throws(()=>validate(album,[{...photo(),file:'../secret.jpg'}]));
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
  const api=async(method,path,body)=>{if(method==='GET')return [repo('gallery01',false,900*1024),repo('gallery02',true,1)];created.push(body);return repo(body.name,false,0);};
  assert.equal((await chooseArchive(api,100)).repo,'Hyper-jiawei/gallery03');assert.equal(created[0].private,false);
});
function fake(tree=[]) {
  const calls=[], commits=[],blobs=new Map();let n=0;
  const api=async(method,path,body)=>{
    calls.push({method,path,body});
    if(path.startsWith('/user/repos')) return [{name:'gallery01',private:false,size:0,full_name:'Hyper-jiawei/gallery01',default_branch:'main',owner:{login:'Hyper-jiawei'}}];
    if(path.includes('/git/ref/'))return {object:{sha:'head'}};
    if(method==='GET' && path.includes('/git/commits/'))return {tree:{sha:'tree'}};
    if(method==='GET' && path.includes('/git/trees/'))return {tree:path.includes(MAIN)?tree:[],truncated:false};
    if(path.endsWith('/git/blobs')){const data=new Blob([Buffer.from(body.content,'base64')]),sha=await blobSha(data);blobs.set(sha,await data.text());return {sha};}
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
