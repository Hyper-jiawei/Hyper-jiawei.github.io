import { connectionVault } from './connection.mjs';
import { configFor, github, publish, settingsFor, listRepositories, checkRepository, selectedFiles, enableHeicBrands, readPhotoDate, publicationFor, photoTitle } from './core.mjs';
import { fileParsers, parse as parseExif } from './photo-exif.js';
enableHeicBrands(fileParsers);
const $=id=>document.getElementById(id);
let photos=[], urls=[], api, busy=false, reading=false, selection={kind:'single'};
const pickers={files:'single',folder:'folder',albumFiles:'album'};
const vault=connectionVault();
let connectionVersion=0, authWrites=Promise.resolve();
const updateSaved=fn=>authWrites=authWrites.catch(()=>{}).then(fn);
const targetFields=['repository','branch','contentPath','archiveOwner','archivePrefix','archiveRepository','mode'];
function targetValues(){return Object.fromEntries(targetFields.map(k=>[k,$(k).value]));}
function targetSummary(){
  const v=targetValues();$('targetSummary').textContent=`提交目标：${v.repository} · ${v.branch||'默认分支'} · ${v.contentPath}/<专辑目录>。原图库：${v.archiveRepository||((v.archiveOwner||v.repository.split('/')[0])+'/'+v.archivePrefix+'01、02…')}`;
}
function rememberTargets(){
  targetSummary();$('repositoryStatus').textContent='设置已变更，发布前会重新检查目标仓库写入能力。';
  try{localStorage.setItem('hyper-gallery-target',JSON.stringify(targetValues()));}catch{}
}
try{const saved=JSON.parse(localStorage.getItem('hyper-gallery-target')||'null');if(saved)targetFields.forEach(k=>{if(typeof saved[k]==='string')$(k).value=saved[k];});}catch{}
targetFields.forEach(k=>$(k).addEventListener('change',rememberTargets));targetSummary();
const fields=['categories','description'];
const status=(text,error=false)=>{ $('status').textContent=text; $('status').className=error?'error':''; };
const album=()=>({
  ...publicationFor(selection,photos), ...selection.legacy,
  categories:selection.kind==='single'?[]:$('categories').value.split(/[,，、]/).map(x=>x.trim()).filter(Boolean),
  description:selection.kind==='single'?(photos[0]?.description??''):$('description').value,
  showPalette:true,
});
const run=fn=>async()=>{if(busy||reading)return;try{await fn();}catch(e){status(e.message,true);}};
function updateControls(){
  for(const id of ['generate','downloadConfig','saveDraft','publish'])$(id).disabled=busy||reading||!photos.length;
  for(const id of [...Object.keys(pickers),'restore'])$(id).disabled=busy||reading;
}
function resetConfig(){$('config').textContent='生成后显示配置';}
function applySelection(next, items){
  selection=next;photos=items;fields.forEach(k=>$(k).value='');$('allowUpdate').checked=false;$('albumExtras').open=false;
  resetConfig();$('links').replaceChildren();render();
}
function render(){
  const single=selection.kind==='single', current=album();
  $('editor').hidden=!photos.length;$('albumExtras').hidden=single;
  $('editorTitle').textContent=single?'单张照片':'专辑照片';
  $('selectionTitle').textContent=single?'':current.title;
  const dateLabel={folder:'文件夹名称',photo:single?'照片元数据':'最早的照片日期',draft:'原草稿'}[current.dateSource];
  $('selectionDate').textContent=current.date?`${current.date} · ${dateLabel}`:'未读到日期，发布时留空';
  urls.forEach(URL.revokeObjectURL); urls=[]; $('photos').replaceChildren();
  photos.forEach((p,i)=>{
    const card=document.createElement('article');card.className='photo';
    const head=document.createElement('div');head.className='photo-head';
    const img=document.createElement('img');const url=URL.createObjectURL(p.blob);urls.push(url);img.src=url;img.alt='照片 '+(i+1);img.loading='lazy';img.onerror=()=>{img.removeAttribute('src');img.alt='HEIC / 原图';};
    const info=document.createElement('div');info.className='file-info';
    const name=document.createElement('strong');name.className='photo-name';name.textContent=photoTitle(p.file);
    info.append(name,document.createTextNode(`${p.file} · ${(p.blob.size/1024**2).toFixed(2)} MiB${single?'':` · ${p.date||'无原始日期'}`}`));
    head.append(img,info);card.append(head);
    const desc=document.createElement('label');desc.textContent='照片描述（可留空）';const area=document.createElement('textarea');area.rows=2;area.value=p.description;area.oninput=()=>{p.description=area.value;resetConfig();};desc.append(area);card.append(desc);
    const checks=document.createElement('div');checks.className='controls';
    for(const [type,text,key] of [['radio','专辑封面','cover'],['checkbox','首页精选','featured']]){
      if(single&&key==='cover')continue;
      const label=document.createElement('label');label.className='check';const check=document.createElement('input');check.type=type;check.name=key==='cover'?'cover':'featured-'+i;check.checked=!!p[key];check.onchange=()=>{if(key==='cover')photos.forEach(x=>x.cover=false);p[key]=check.checked;resetConfig();};label.append(check,document.createTextNode(text));checks.append(label);
    }
    card.append(checks);const controls=document.createElement('div');controls.className='controls';
    for(const [text,fn,disabled] of [['↑',()=>{[photos[i-1],photos[i]]=[photos[i],photos[i-1]];},i===0],['↓',()=>{[photos[i+1],photos[i]]=[photos[i],photos[i+1]];},i===photos.length-1],['移除',()=>{photos.splice(i,1);if(!photos.some(x=>x.cover)&&photos[0])photos[0].cover=true;},false]]){if(single&&text!=='移除')continue;const b=document.createElement('button');b.textContent=text;b.disabled=disabled;b.onclick=()=>{fn();resetConfig();render();};controls.append(b);}card.append(controls);$('photos').append(card);
  });
  $('count').textContent=photos.length+' 张';$('total').textContent=photos.length?`${photos.length} 张 · ${(photos.reduce((n,p)=>n+p.blob.size,0)/1024**2).toFixed(1)} MiB`:'原图直传 · iPhone / Mac';
  updateControls();
}
fields.forEach(id=>$(id).addEventListener('input',resetConfig));
for(const [id,kind] of Object.entries(pickers))$(id).onchange=run(async()=>{
  const chosen=[...$(id).files];$(id).value='';if(!chosen.length)return;
  const next=selectedFiles(kind,chosen);
  if(photos.length&&!confirm('替换当前选中的照片和文案？'))return;
  reading=true;updateControls();
  try{
    const items=[];
    for(const file of next.files){
      status(`正在读取原始日期 ${items.length+1}/${next.files.length} · ${file.name}`);
      items.push({file:file.name,blob:file,date:await readPhotoDate(file,parseExif),description:'',cover:!items.length});
    }
    applySelection({kind:next.kind,folderName:next.folderName},items);
    status('照片已选好，可以添加描述。未上传任何照片。');
  }finally{reading=false;updateControls();}
});
async function connectToken(token, version, automatic=false) {
  const candidate=github(token);
  const user=await candidate('GET','/user');
  if(version!==connectionVersion)return;
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
  $('connection').textContent='账号已连接 '+user.login;
  status(automatic?'已自动恢复账号连接；发布前会检查所选仓库写入权限。':$('remember').checked?'账号已连接并记住此设备；请确认仓库与存储设置。':'账号已连接，仅本次有效；请确认仓库与存储设置。');
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
$('loadRepositories').onclick=run(async()=>{
  if(!api)throw Error('请先连接 GitHub');const repositories=await listRepositories(api);$('repositoryOptions').replaceChildren();
  for(const repo of repositories){const option=document.createElement('option');option.value=repo.full_name;$('repositoryOptions').append(option);}
  $('repositoryStatus').textContent=`已读取 ${repositories.length} 个可访问仓库，可在目标输入框中选择；写入权限会单独检查。`;
});
$('checkRepository').onclick=run(async()=>{
  if(!api)throw Error('请先连接 GitHub');const settings=settingsFor(targetValues());$('repositoryStatus').textContent='正在检查实际写入能力…';
  try{const info=await checkRepository(api,settings.repository);$('repositoryStatus').textContent=`目标仓库写入检查通过：${info.full_name||settings.repository}；发布时仍会重新检查。`;}catch(error){$('repositoryStatus').textContent=error.message;throw error;}
});
function generateConfig(){return $('config').textContent=configFor(album(),photos);}
$('generate').onclick=run(async()=>{generateConfig();status('配置已生成，未上传照片。');});
function saveFile(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('downloadConfig').onclick=run(async()=>{saveFile(new Blob([generateConfig()],{type:'text/plain;charset=utf-8'}),'index.md');});
function db(){return new Promise((resolve,reject)=>{const req=indexedDB.open('hyper-gallery-publisher',1);req.onupgradeneeded=()=>req.result.createObjectStore('draft');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function draft(action,value){const database=await db();try{return await new Promise((resolve,reject)=>{const tx=database.transaction('draft',action==='get'?'readonly':'readwrite');const store=tx.objectStore('draft');const req=action==='get'?store.get('current'):action==='put'?store.put(value,'current'):store.delete('current');let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('草稿存储失败'));});}finally{database.close();}}
$('saveDraft').onclick=run(async()=>{await draft('put',{selection,values:Object.fromEntries(fields.map(k=>[k,$(k).value])),photos,allowUpdate:$('allowUpdate').checked,target:targetValues()});status('草稿和原图已存到此设备，未上传。');});
$('restore').onclick=run(async()=>{
  reading=true;updateControls();
  try{
    const saved=await draft('get');if(!saved)throw Error('此设备没有草稿');
    if(photos.length&&!confirm('恢复草稿将替换当前未保存的编辑，继续吗？'))return;
    const {title,slug,date}=saved.values;
    applySelection(saved.selection??{kind:'album',legacy:{title,slug,date,dateSource:'draft'}},saved.photos);
    fields.forEach(k=>$(k).value=saved.values[k]||'');
    if(saved.target){targetFields.forEach(k=>{if(typeof saved.target[k]==='string')$(k).value=saved.target[k];});rememberTargets();}
    $('allowUpdate').checked=!!saved.allowUpdate;status(api?'草稿已恢复，GitHub 保持连接。':'草稿已恢复，请连接 GitHub。');
  }finally{reading=false;updateControls();}
});
$('clearDraft').onclick=run(async()=>{if(confirm('清除这台设备保存的草稿？不会删除已发布内容或系统相册原图。')){await draft('delete');status('本机草稿已清除');}});
$('publish').onclick=run(async()=>{
  if(!api){$('token').closest('details').open=true;$('token').focus();throw Error('请先连接 GitHub 再发布');}
  generateConfig();
  const target=settingsFor(targetValues()), current=album();
  if(!confirm(`将「${current.title}」的 ${photos.length} 张原图和配置发布到 ${target.repository}（${target.branch||'默认分支'}）的 ${target.contentPath}/${current.slug}/。原图按设置公开存放，是否继续？`))return;
  busy=true;document.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=true);let wake;
  const before=e=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',before);
  try{
    try{wake=await navigator.wakeLock?.request('screen');}catch{}
    const result=await publish(api,current,photos,$('allowUpdate').checked,status,target);
    $('links').replaceChildren();for(const [label,url] of [['查看提交',result.url],['部署进度',result.actions],['原图分仓',result.archive?'https://github.com/'+result.archive:null]]){if(!url)continue;const a=document.createElement('a');a.href=url;a.textContent=label;a.target='_blank';a.rel='noopener noreferrer';$('links').append(a);}
    status('提交成功，等待 GitHub Actions 部署。可以继续保存本机草稿。');
  }finally{await wake?.release();window.removeEventListener('beforeunload',before);busy=false;document.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=false);render();}
});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
