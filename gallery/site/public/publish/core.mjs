import { buildConfig } from './config.mjs';
export const MAIN = 'Hyper-jiawei/Hyper-jiawei.github.io';
export const MAIN_BUDGET = 650 * 1024 ** 2, ARCHIVE_BUDGET = 800 * 1024 ** 2;
const IMAGE = /\.(jpe?g|png|webp|tiff?|heic|heif)$/i;
export function settingsFor(values = {}) {
  const settings = {
    repository: (values.repository || MAIN).trim(), branch: (values.branch ?? '').trim(),
    contentPath: (values.contentPath || 'gallery/content').trim().replace(/^\/+|\/+$/g, ''),
    archiveOwner: (values.archiveOwner || '').trim(), archivePrefix: (values.archivePrefix || 'gallery').trim(),
    archiveRepository: (values.archiveRepository || '').trim(), mode: values.mode || 'auto',
  };
  const repository = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;
  if (!repository.test(settings.repository) || settings.repository.split('/')[1] === '.' || settings.repository.split('/')[1] === '..') throw Error('目标仓库请填写 owner/repository');
  if (!settings.contentPath || settings.contentPath.split('/').some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f?#%]/.test(p))) throw Error('专辑路径不能包含空段、.. 或特殊符号');
  if (settings.branch && (/[\s~^:?*\[\\]/.test(settings.branch) || settings.branch.includes('..') || settings.branch.includes('@{') || settings.branch.startsWith('/') || settings.branch.endsWith('/') || settings.branch.endsWith('.lock'))) throw Error('分支名格式不正确');
  settings.archiveOwner ||= settings.repository.split('/')[0];
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(settings.archiveOwner) || !/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(settings.archivePrefix)) throw Error('原图库账号或命名前缀格式不正确');
  if (settings.archiveRepository && !repository.test(settings.archiveRepository)) throw Error('指定原图库请填写 owner/repository');
  if (settings.archiveRepository.toLowerCase() === settings.repository.toLowerCase()) throw Error('分仓原图库不能与目标网站仓库相同');
  if (!['auto', 'archive', 'main'].includes(settings.mode)) throw Error('请选择正确的存储方式');
  if (settings.mode === 'main' && settings.archiveRepository) throw Error('使用指定原图库时，请将存储方式改为自动分仓或始终分仓');
  return settings;
}
export async function listRepositories(api) {
  let repositories = [], page = 1;
  while (true) {
    const batch = await api('GET', `/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&page=${page++}`);
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
  }
}
export async function checkRepository(api, repository, publicOnly = false) {
  const info = await api('GET', `/repos/${repository}`);
  if (info.archived || info.disabled) throw Error(repository + ' 已归档或停用，无法发布');
  if (publicOnly && info.private) throw Error(repository + ' 不是公开仓库，无法提供公开原图下载');
  if (info.permissions?.push === false) throw Error(repository + ' 没有写入权限，请检查所选仓库及 Contents: Read and write');
  // User-level push permission does not prove this PAT can write. A detached empty
  // blob verifies Git Database access without changing files, branches or Actions.
  await api('POST', `/repos/${repository}/git/blobs`, { encoding: 'utf-8', content: '' });
  return info;
}
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
export function estimate(tree, incoming, contentPath = "gallery/content") {
  return tree.filter(e=>e.path.startsWith(contentPath + '/') && e.type==='blob').reduce((n,e)=>n+(e.size||0)*(IMAGE.test(e.path) && !e.path.includes('/_preview/')?3:1),0)+incoming*3;
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
      const operation = method === 'POST' && /\/(user|orgs\/[^/]+)\/repos$/.test(path) ? '创建原图库' : method === 'POST' && path.endsWith('/git/blobs') ? '写入仓库内容' : method === 'PATCH' && path.includes('/git/refs/') ? '更新仓库分支' : '访问 GitHub';
      const help = response.status === 403 || response.status === 404
        ? operation === '创建原图库' ? '需要覆盖新仓库的授权范围和 Repository creation 写入权限；旧权限方案也可使用 Administration 写入。Classic 令牌可使用 public_repo。' : '请检查令牌 Repository access 是否覆盖此仓库，以及 Contents 是否为 Read and write。'
        : '网络中断后可重试；若分支受保护，请选择允许直接提交的分支。';
      const error = Error(`${operation}失败 · ${method} ${path.split('?')[0]} · GitHub ${response.status}：${detail || '连接失败'}。${help}`);
      error.status = response.status;
      throw error;
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
export async function chooseArchive(api, incoming, values = {}) {
  const settings = settingsFor(values);
  if (settings.archiveRepository) {
    const info = await checkRepository(api, settings.archiveRepository, true);
    if ((info.size || 0) * 1024 + incoming >= ARCHIVE_BUDGET) throw Error('指定原图库接近 800 MiB 预算，请换一个原图库或留空自动编号');
    return {repo: info.full_name || settings.archiveRepository, branch: info.default_branch};
  }
  const owner = settings.archiveOwner, prefix = settings.archivePrefix;
  const match = new RegExp('^' + prefix + '(\\d{2,})$');
  const repos = (await listRepositories(api)).filter(r => r.owner.login.toLowerCase() === owner.toLowerCase() && match.test(r.name) && r.full_name.toLowerCase() !== settings.repository.toLowerCase()).sort((a,b) => Number(b.name.slice(prefix.length)) - Number(a.name.slice(prefix.length)));
  const existing = repos.find(r => !r.private && (r.size || 0) * 1024 + incoming < ARCHIVE_BUDGET);
  if (existing) {
    const info = await checkRepository(api, existing.full_name, true);
    return {repo: existing.full_name, branch: info.default_branch || existing.default_branch};
  }
  const number = Number(repos[0]?.name.slice(prefix.length) || 0) + 1;
  const account = await api('GET', '/user');
  const ownerInfo = owner.toLowerCase() === account.login.toLowerCase() ? account : await api('GET', '/users/' + owner);
  if (ownerInfo.type !== 'Organization' && owner.toLowerCase() !== account.login.toLowerCase()) throw Error('只能在当前账号或有建仓权限的组织下自动创建原图库；其他账号请指定已有原图库');
  const endpoint = ownerInfo.type === 'Organization' ? '/orgs/' + owner + '/repos' : '/user/repos';
  const created = await api('POST', endpoint, {name: prefix + String(number).padStart(2,'0'), private:false, auto_init:true, description:'Gallery public originals and album configuration'});
  if (created.private) throw Error('创建的仓库不是公开仓库，已停止');
  // New repositories also need Contents write permission, independently of creation.
  await checkRepository(api, created.full_name, true);
  return {repo: created.full_name, branch: created.default_branch};
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
export async function publish(api, album, photos, allowUpdate, progress = () => {}, values = {}) {
  const settings = settingsFor(values), repository = settings.repository;
  const config = configFor(album, photos), prefix = settings.contentPath + '/' + album.slug + '/';
  progress('检查目标仓库写入权限 · ' + repository);
  const info = await checkRepository(api, repository);
  const branch = settings.branch || info.default_branch;
  const main = await snapshot(api, repository, branch);
  if (!allowUpdate && main.tree.some(e => e.path.startsWith(prefix))) throw Error('同名专辑已存在，请勾选「更新同名专辑」');
  const files = photos.map(p => ({name:p.file, blob:p.blob})); files.push({name:'index.md', blob:new Blob([config])});
  const incoming = photos.reduce((n,p) => n + p.blob.size, 0);
  const alreadyArchived = main.tree.some(e => e.path === prefix + '_processed.json' || e.path === prefix + '_sources.json');
  const overBudget = estimate(main.tree, incoming, settings.contentPath) > MAIN_BUDGET;
  if (settings.mode === 'main' && (alreadyArchived || overBudget)) throw Error('目标仓库接近容量预算或该专辑已分仓，请选择自动分仓或始终分仓');
  const archiveNeeded = settings.mode === 'archive' || Boolean(settings.archiveRepository) || overBudget || alreadyArchived;
  let archive;
  if (archiveNeeded) {
    progress('检查公开原图库容量');
    archive = await chooseArchive(api, incoming, settings);
    const snap = await snapshot(api, archive.repo, archive.branch);
    const commit = await commitFiles(api, archive.repo, archive.branch, snap, files, prefix, progress);
    const sources = {repository:archive.repo, commit, path:prefix, files:[]};
    for (const p of photos) sources.files.push({name:p.file, sha:await blobSha(p.blob), size:p.blob.size});
    files.splice(0, files.length, {name:'index.md',blob:new Blob([config])}, {name:'_sources.json',blob:new Blob([JSON.stringify(sources)])});
  }
  progress('提交专辑配置 · ' + repository + ' / ' + branch);
  const commit = await commitFiles(api, repository, branch, main, files, prefix, progress);
  return {commit, repository, branch, archive:archive?.repo, actions:`https://github.com/${repository}/actions`, url:`https://github.com/${repository}/commit/${commit}`};
}
