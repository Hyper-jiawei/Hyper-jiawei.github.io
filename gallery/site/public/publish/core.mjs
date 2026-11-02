import { buildConfig } from './config.mjs';
export const MAIN = 'Hyper-jiawei/Hyper-jiawei.github.io';
export const MAIN_BUDGET = 650 * 1024 ** 2, ARCHIVE_BUDGET = 800 * 1024 ** 2;
const IMAGE = /\.(jpe?g|png|webp|tiff?|heic|heif)$/i;
export function validate(album, photos) {
  if (!album.title.trim()) throw Error('请填写专辑标题');
  if (!/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*$/u.test(album.slug)) throw Error('目录名请使用中文、字母、数字、横线或下划线');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(album.date) || !Number.isFinite(Date.parse(album.date)) || new Date(album.date).toISOString().slice(0,10) !== album.date) throw Error('请填写有效日期');
  if (!photos.length) throw Error('请先选择照片');
  const names = new Set();
  for (const p of photos) {
    if (!IMAGE.test(p.file) || /[\\/\u0000-\u001f?#%]/.test(p.file) || p.file.startsWith('.')) throw Error('不支持的文件名：' + p.file);
    const stem = p.file.replace(/\.[^.]+$/,'');
    if (!stem.trim() || names.has(stem)) throw Error('照片标题重复或为空：' + stem);
    names.add(stem);
    if (p.blob.size >= 100 * 1024 ** 2) throw Error(p.file + ' 超过单文件 100 MiB 限制');
  }
  if (photos.reduce((n,p)=>n+p.blob.size,0) >= ARCHIVE_BUDGET) throw Error('单辑请控制在 800 MiB 以内');
  if (photos.filter(p=>p.cover).length !== 1) throw Error('请选择一张封面');
}
export function configFor(album, photos) { validate(album,photos); return buildConfig({...album,photos}); }
export function estimate(tree, incoming) {
  return tree.filter(e=>e.path.startsWith('gallery/content/') && e.type==='blob').reduce((n,e)=>n+(e.size||0)*(IMAGE.test(e.path) && !e.path.includes('/_preview/')?3:1),0)+incoming*3;
}
export async function blobSha(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length+bytes.length); all.set(header); all.set(bytes,header.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1',all))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function base64(blob) {
  const b = new Uint8Array(await blob.arrayBuffer()); let out='';
  for(let i=0;i<b.length;i+=32768) out+=String.fromCharCode(...b.subarray(i,i+32768));
  return btoa(out);
}
export function github(token, request = fetch) {
  return async (method,path,body) => {
    const response = await request('https://api.github.com'+path,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body ? {body:JSON.stringify(body)}:{})});
    if(!response.ok) {
      let detail=''; try{detail=(await response.json()).message||'';}catch{}
      throw Error(`GitHub ${response.status}：${detail || '连接失败'}。权限不足时检查令牌；网络中断后可重试。`);
    }
    return response.status===204 ? null : response.json();
  };
}
export async function snapshot(api, repo, branch='main') {
  const head = await api('GET',`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const sha=head.object.sha;
  const commit=await api('GET',`/repos/${repo}/git/commits/${sha}`);
  const tree=await api('GET',`/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  if(tree.truncated) throw Error('仓库目录返回不完整，已停止发布');
  return {sha,treeSha:commit.tree.sha,tree:tree.tree};
}
export async function chooseArchive(api,incoming) {
  let repos=[], page=1;
  while(true) { const batch=await api('GET',`/user/repos?affiliation=owner&per_page=100&page=${page++}`); repos.push(...batch); if(batch.length<100) break; }
  repos=repos.filter(r=>r.owner.login.toLowerCase()==='hyper-jiawei' && /^gallery\d{2,}$/.test(r.name)).sort((a,b)=>Number(b.name.slice(7))-Number(a.name.slice(7)));
  const existing=repos.find(r=>!r.private && r.size*1024+incoming<ARCHIVE_BUDGET);
  if(existing) return {repo:existing.full_name,branch:existing.default_branch};
  const number=Number(repos[0]?.name.slice(7)||0)+1;
  const created=await api('POST','/user/repos',{name:'gallery'+String(number).padStart(2,'0'),private:false,auto_init:true,description:'Hyper Gallery public originals and album configuration'});
  if(created.private) throw Error('创建的仓库不是公开仓库，已停止');
  return {repo:created.full_name,branch:created.default_branch};
}
export async function commitFiles(api, repo, branch, snap, files, prefix, progress=()=>{}) {
  const entries=[], keep=new Set(files.map(f=>prefix+f.name)); let done=0;
  // One original at a time keeps iPhone memory usage bounded and reports precise failures.
  for(const {name,blob} of files) {
    progress(`上传 ${++done}/${files.length} · ${name}`);
    const sha=await blobSha(blob), target=prefix+name;
    if(!snap.tree.some(e=>e.path===target && e.sha===sha)) {
      const result=await api('POST',`/repos/${repo}/git/blobs`,{encoding:'base64',content:await base64(blob)});
      if(result.sha!==sha) throw Error('上传校验失败：'+name);
      entries.push({path:target,mode:'100644',type:'blob',sha});
    }
  }
  for(const e of snap.tree) {
    if(e.type!=='blob' || !e.path.startsWith(prefix) || keep.has(e.path)) continue;
    const leaf=e.path.slice(prefix.length);
    if(leaf.startsWith('_preview/') || ['index.md','_processed.json','_sources.json'].includes(leaf) || (!leaf.includes('/') && IMAGE.test(leaf))) entries.push({path:e.path,mode:'100644',type:'blob',sha:null});
  }
  if(!entries.length) return snap.sha;
  const tree=await api('POST',`/repos/${repo}/git/trees`,{base_tree:snap.treeSha,tree:entries});
  const commit=await api('POST',`/repos/${repo}/git/commits`,{tree:tree.sha,parents:[snap.sha],message:'gallery: publish '+prefix.split('/').filter(Boolean).pop()+' from iPhone'});
  const latest=await api('GET',`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if(latest.object.sha!==snap.sha) throw Error('远端有新提交，请重试；不会覆盖别人的更新');
  await api('PATCH',`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,{sha:commit.sha,force:false});
  return commit.sha;
}
export async function publish(api,album,photos,allowUpdate,progress=()=>{}) {
  const config=configFor(album,photos), prefix='gallery/content/'+album.slug+'/';
  const main=await snapshot(api,MAIN);
  if(!allowUpdate && main.tree.some(e=>e.path.startsWith(prefix))) throw Error('同名专辑已存在，请勾选「更新同名专辑」');
  const files=photos.map(p=>({name:p.file,blob:p.blob})); files.push({name:'index.md',blob:new Blob([config])});
  const incoming=photos.reduce((n,p)=>n+p.blob.size,0);
  const archiveNeeded=estimate(main.tree,incoming)>MAIN_BUDGET || main.tree.some(e=>e.path===prefix+'_processed.json' || e.path===prefix+'_sources.json');
  let archive;
  if(archiveNeeded) {
    progress('检查公开原图库容量');
    archive=await chooseArchive(api,incoming);
    const snap=await snapshot(api,archive.repo,archive.branch);
    const commit=await commitFiles(api,archive.repo,archive.branch,snap,files,prefix,progress);
    const sources={repository:archive.repo,commit,files:[]};
    for(const p of photos) sources.files.push({name:p.file,sha:await blobSha(p.blob),size:p.blob.size});
    files.splice(0,files.length,{name:'index.md',blob:new Blob([config])},{name:'_sources.json',blob:new Blob([JSON.stringify(sources)])});
  }
  progress('提交专辑配置');
  const commit=await commitFiles(api,MAIN,'main',main,files,prefix,progress);
  return {commit,archive:archive?.repo,actions:`https://github.com/${MAIN}/actions`,url:`https://github.com/${MAIN}/commit/${commit}`};
}
