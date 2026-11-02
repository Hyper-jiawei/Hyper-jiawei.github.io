import { connectionVault } from './connection.mjs';
import { configFor, github, publish } from './core.mjs';
const $=id=>document.getElementById(id);
let photos=[], urls=[], api, busy=false, config='';
const vault=connectionVault();
let connectionVersion=0, authWrites=Promise.resolve();
const updateSaved=fn=>authWrites=authWrites.catch(()=>{}).then(fn);
const fields=['title','slug','date','categories','description'];
const today=new Date(); $('date').value=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
const status=(text,error=false)=>{ $('status').textContent=text; $('status').className=error?'error':''; };
const album=()=>({title:$('title').value,slug:$('slug').value.trim(),date:$('date').value,categories:$('categories').value.split(/[,，、]/).map(x=>x.trim()).filter(Boolean),description:$('description').value,showPalette:true});
const run=fn=>async()=>{if(busy)return;try{await fn();}catch(e){status(e.message,true);}};
function render(){
  urls.forEach(URL.revokeObjectURL); urls=[]; $('photos').replaceChildren();
  photos.forEach((p,i)=>{
    const card=document.createElement('article');card.className='photo';
    const head=document.createElement('div');head.className='photo-head';
    const img=document.createElement('img');const url=URL.createObjectURL(p.blob);urls.push(url);img.src=url;img.alt='照片 '+(i+1);img.loading='lazy';img.onerror=()=>{img.removeAttribute('src');img.alt='HEIC / 原图';};
    const info=document.createElement('div');info.className='file-info';info.textContent=`${String(i+1).padStart(2,'0')} / ${p.file} · ${(p.blob.size/1024**2).toFixed(2)} MiB`;
    head.append(img,info);card.append(head);
    const title=document.createElement('label');title.textContent='照片标题（文件名）';const input=document.createElement('input');input.value=p.file.replace(/\.[^.]+$/,'');input.oninput=()=>{p.file=input.value+p.extension;};title.append(input);card.append(title);
    const checks=document.createElement('div');checks.className='controls';
    for(const [type,text,key] of [['radio','专辑封面','cover'],['checkbox','首页精选','featured']]){
      const label=document.createElement('label');label.className='check';const check=document.createElement('input');check.type=type;check.name=key==='cover'?'cover':'featured-'+i;check.checked=!!p[key];check.onchange=()=>{if(key==='cover')photos.forEach(x=>x.cover=false);p[key]=check.checked;};label.append(check,document.createTextNode(text));checks.append(label);
    }
    card.append(checks);const desc=document.createElement('label');desc.textContent='照片简介（可留空）';const area=document.createElement('textarea');area.rows=2;area.value=p.description;area.oninput=()=>p.description=area.value;desc.append(area);card.append(desc);
    const controls=document.createElement('div');controls.className='controls';
    for(const [text,fn,disabled] of [['↑',()=>{[photos[i-1],photos[i]]=[photos[i],photos[i-1]];render();},i===0],['↓',()=>{[photos[i+1],photos[i]]=[photos[i],photos[i+1]];render();},i===photos.length-1],['移除',()=>{photos.splice(i,1);if(!photos.some(x=>x.cover)&&photos[0])photos[0].cover=true;render();},false]]){const b=document.createElement('button');b.textContent=text;b.disabled=disabled;b.onclick=fn;controls.append(b);}card.append(controls);$('photos').append(card);
  });
  $('count').textContent=photos.length+' 张';$('total').textContent=`${photos.length} 张 · ${(photos.reduce((n,p)=>n+p.blob.size,0)/1024**2).toFixed(1)} MiB`;
}
$('files').onchange=run(async()=>{for(const file of $('files').files){if(!/\.(jpe?g|png|webp|tiff?|heic|heif)$/i.test(file.name))throw Error('暂不支持 '+file.name);photos.push({file:file.name,extension:file.name.match(/\.[^.]+$/)[0],blob:file,description:'',cover:photos.length===0});}render();status('照片已选择，可以修改标题、简介和精选。');$('files').value='';});
async function connectToken(token, version, automatic=false) {
  const candidate=github(token);
  const user=await candidate('GET','/user');
  if(version!==connectionVersion)return;
  if(user.login.toLowerCase()!=='hyper-jiawei')throw Error('请使用 Hyper-jiawei 的 GitHub 账号');
  api=candidate;$('token').value='';
  if(!automatic){
    try {
      const remember=$('remember').checked;
      await updateSaved(async()=>{if(version===connectionVersion)await (remember?vault.save(token):vault.clear());});
    } catch {
      if(version===connectionVersion){$('connection').textContent='已连接（仅本次）';status('GitHub 已连接，但此浏览器无法保存连接。请检查是否为私密模式或存储空间不足。',true);}
      return;
    }
  }
  if(version!==connectionVersion)return;
  $('connection').textContent='已连接 '+user.login;
  status(automatic?'已使用此设备保存的连接自动登录 GitHub。':$('remember').checked?'GitHub 已连接，并已记住此设备。':'GitHub 已连接，仅本次打开有效。');
}
$('connect').onclick=run(async()=>{
  const token=$('token').value.trim();if(!token)throw Error('请先填写 GitHub 访问令牌');
  const version=++connectionVersion;
  try{await connectToken(token,version);}catch(error){if(version===connectionVersion){api=undefined;$('connection').textContent='连接失败';throw error;}}
});
$('disconnect').onclick=run(async()=>{
  ++connectionVersion;api=undefined;$('token').value='';$('connection').textContent='未连接';
  await updateSaved(()=>vault.clear());status('已断开，并清除此设备保存的连接。');
});
async function restoreConnection(){
  const version=connectionVersion;
  try{
    const token=await vault.read();if(!token||version!==connectionVersion)return;
    $('connection').textContent='正在自动连接…';
    await connectToken(token,version,true);
  }catch{
    if(version!==connectionVersion)return;
    api=undefined;$('connection').textContent='请重新连接';
    status('自动连接未成功：请检查网络，或令牌是否已撤销、过期。可以重新填写令牌连接。',true);
  }
}
void restoreConnection();
$('generate').onclick=run(async()=>{config=configFor(album(),photos);$('config').textContent=config;status('配置已生成，未上传照片。');});
function saveFile(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('downloadConfig').onclick=run(async()=>{config=configFor(album(),photos);$('config').textContent=config;saveFile(new Blob([config],{type:'text/plain;charset=utf-8'}),'index.md');});
function db(){return new Promise((resolve,reject)=>{const req=indexedDB.open('hyper-gallery-publisher',1);req.onupgradeneeded=()=>req.result.createObjectStore('draft');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function draft(action,value){const database=await db();try{return await new Promise((resolve,reject)=>{const tx=database.transaction('draft',action==='get'?'readonly':'readwrite');const store=tx.objectStore('draft');const req=action==='get'?store.get('current'):action==='put'?store.put(value,'current'):store.delete('current');let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('草稿存储失败'));});}finally{database.close();}}
$('saveDraft').onclick=run(async()=>{await draft('put',{values:Object.fromEntries(fields.map(k=>[k,$(k).value])),photos,allowUpdate:$('allowUpdate').checked});status('草稿和原图已存到此设备，未上传。');});
$('restore').onclick=run(async()=>{const saved=await draft('get');if(!saved)throw Error('此设备没有草稿');if(photos.length&&!confirm('恢复草稿将替换当前未保存的编辑，继续吗？'))return;fields.forEach(k=>$(k).value=saved.values[k]||'');photos=saved.photos;$('allowUpdate').checked=!!saved.allowUpdate;render();status(api?'草稿已恢复，GitHub 保持连接。':'草稿已恢复，请连接 GitHub。');});
$('clearDraft').onclick=run(async()=>{if(confirm('清除这台设备保存的草稿？不会删除已发布内容或系统相册原图。')){await draft('delete');status('本机草稿已清除');}});
$('publish').onclick=run(async()=>{
  if(!api)throw Error('请先展开 GitHub 连接并登录');config=configFor(album(),photos);$('config').textContent=config;
  if(!confirm(`将 ${photos.length} 张原图和配置发布到公开 Gallery，是否继续？`))return;
  busy=true;document.querySelectorAll('button,input,textarea').forEach(e=>e.disabled=true);let wake;
  const before=e=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',before);
  try{
    try{wake=await navigator.wakeLock?.request('screen');}catch{}
    const result=await publish(api,album(),photos,$('allowUpdate').checked,status);
    $('links').replaceChildren();for(const [label,url] of [['查看提交',result.url],['部署进度',result.actions],['原图分仓',result.archive?'https://github.com/'+result.archive:null]]){if(!url)continue;const a=document.createElement('a');a.href=url;a.textContent=label;a.target='_blank';a.rel='noopener noreferrer';$('links').append(a);}
    status('提交成功，等待 GitHub Actions 部署。可以继续保存本机草稿。');
  }finally{await wake?.release();window.removeEventListener('beforeunload',before);busy=false;document.querySelectorAll('button,input,textarea').forEach(e=>e.disabled=false);render();}
});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
