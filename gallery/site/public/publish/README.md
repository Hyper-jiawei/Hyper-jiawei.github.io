# iPhone Gallery 发布工具

地址：<https://hyper-jiawei.github.io/gallery/publish/>

用 iPhone Safari 打开，点击「分享 → 添加到主屏幕 → 添加」，以后可从桌面图标独立打开，不需要 Mac。不是 App Store 安装包。

1. 在「GitHub 连接」中填自己的访问令牌。普通发布只需主站仓库 Contents 读写权限。工具支持当前登录账号或有授权的组织，不固定账号。默认勾选「记住此设备，下次自动连接」：验证账号成功后，用 AES-GCM 加密令牌并与不可导出的浏览器 CryptoKey 一起存入此设备专用 IndexedDB，刷新或重新打开自动连接。不勾选则仅本次打开有效。令牌不写入源码、GitHub、专辑草稿或静态缓存。点击「断开并忘记此设备」清除保存的连接。请仅在自己的设备上记住；清理网站数据、私密模式、令牌过期或撤销后需重连。同源恶意脚本仍可能读取保存的连接，这不是硬件钥匙串。
2. 从照片或「文件」选择整辑作品。要保留原始 HEIC / EXIF，建议通过「文件」选择未修改原件；iOS 的相册选择器可能自行转换格式，工具不能恢复系统已转换的文件。会显示实际收到的文件名、格式和大小。
3. 编辑专辑标题、目录名、日期、分类。照片文件名可在手机内改标题（仅更改发布文件名，不改系统相册）。简介可以留空，只有勾选「首页精选」才生成 `featured: true`。指定一张封面，调整顺序。
4. 点击「生成配置文件」检查 index.md，可以下载。不生成默认 `featured: false`。
5. 可选「保存本机草稿」：原文件和文案存入当前设备 IndexedDB，不包含令牌。恢复不会自动上传。恢复草稿不改变当前 GitHub 连接。草稿可能受系统空间、私密模式及 Safari 清理影响，不能代替照片备份。
6. 点击「发布到 Gallery」，确认后开始上传。保持工具在前台、屏幕亮起；不支持锁屏后台上传，断线后可重试。Git 对象按原文件 SHA 跳过重复上传；所有文件成功后才提交。远端有并发提交时停止，不强制覆盖。
7. 等 Actions 部署完成再查看网站。更新旧辑时需选择整辑完整照片，目录名一致并勾选「更新同名专辑」；当前版本中不再选中的旧照片会移除，Git 历史保留。

## 自动分仓

预算同 Mac：主站 650 MiB，公开原图库 800 MiB，单辑小于 800 MiB、单文件小于 100 MiB。达到预算或已分仓时，使用公开 gallery01、gallery02 顺延，跳过私人同名库。

手机不在浏览器中强行解码高分辨率 HEIC。分仓原文件和 index.md 先提交到原图库，主站提交 index.md + `_sources.json`（固定仓库、提交 SHA、文件名、大小与 Git blob SHA）。Actions 校验并取回原文件，生成 WebP / EXIF / 色块；公开站点只发布衍生图，下载直连原图库，免登录。无需创建新的服务器。

自动建仓需要允许创建和写入公开仓库的 GitHub 凭据；仅授权主站的细粒度令牌不足时会明确失败，不会擅自降级、修改私人仓库可见性或向第三方发送令牌。可在 GitHub 使用适合公开仓库的凭据，并在不用时撤销。

## 离线与缓存

添加主屏幕后，工具界面可以离线打开和编辑本机草稿；发布、GitHub 连接仍然需要网络。Service Worker 只缓存发布工具自己的静态界面文件，绝不缓存 GitHub API、令牌和照片。图库页面不受该 Service Worker 控制。

## 免费方案的速度边界

网页预览使用 q82 WebP、自适应尺寸、按需加载，首张精选由浏览器直接请求，内嵌微型预览填补等待。原图不压缩。GitHub Pages、GitHub API 和 raw.githubusercontent.com 的国内线路仍可能慢；公开分仓解决容量，不提供国内网络加速承诺。没有接入收费服务或第三方 GitHub 代理。


## 通用目标仓库与通用令牌

「仓库与存储设置」可以指定网站/配置仓库 `owner/repository`、现有分支（留空自动使用默认分支）、专辑路径；这些设置保存在当前设备，并随本机专辑草稿保存。默认仍是 Hyper-jiawei/Hyper-jiawei.github.io、gallery/content。

「列出可访问仓库」读取当前令牌可见的仓库，亦可直接填写任意有授权的仓库。身份连接与仓库写入能力分开显示。检查写入会向所选仓库写入一个不关联提交的空 Git blob，不改变文件、分支或触发 Actions；发布前总会重新检查。令牌仅有公开读取、没有 Contents 写权限时也能识别账号，因此不能仅以“已连接”判断发布权限。

原图可选：自动到预算再分仓、始终分仓、只用目标仓库（接近预算时停止）。自动原图库支持设置所属账号/组织与前缀，例如 gallery01、gallery02，或 works01、works02。也可直接指定已有的任意名称公开原图库，如 owner/photo-originals；此时优先使用指定库，超预算时停止让用户调整，不偷偷另选目标。主站与原图库不能相同。不会更改已有私人仓库可见性。

原图库无论采用哪个名称，网站仓库里的 `_sources.json` 都固定原图库仓库名、提交、路径、原图大小和 SHA；构建器只从 raw.githubusercontent.com 读取校验过的内容。旧 `_sources.json` 没有 path 时仍兼容 gallery/content/<专辑>。更换目标网站仓库需要那个仓库本身已安装兼容 Gallery 构建和 Pages 部署流程；工具不会给任意空仓库自动建站。自定义专辑路径需要同步调整该仓库工作流里的 GALLERY_CONTENT。

### 一次配置，覆盖今后的 galleryXX

Fine-grained token 推荐如下：

- Resource owner：目标个人账号或组织。
- Repository access：**All repositories**，覆盖该 owner 当前与未来仓库。此范围会扩大 Contents 权限覆盖面，按自身需要选择。
- Repository permissions：**Contents → Read and write**、**Repository creation → Read and write**；Metadata 的 Read-only 保留。
- 如果 GitHub 界面尚未提供 Repository creation，可用 Administration 写入代替建仓权限，但其管理权限更大。工具只调用创建公开库，不删除仓库或修改仓库权限。

只选择几个已有仓库也可以，但需同时包括网站仓库和原图库；以后新增原图库可能还要调整授权。仅有 Repository creation 不能代替 Contents 写权限：新建后工具还会检查新库写入能力。

个人公开仓库的另一方案是 Classic token 的 **public_repo**。它覆盖账号有权限的公开仓库，便于连续创建公开原图库，授权范围更广。组织还可能有令牌审批、SSO 等额外要求。无论哪种令牌都可通过「记住此设备」保存在本机，不写进仓库；工具不能自行扩大 GitHub 授权。

官方依据：[创建仓库权限](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user)、[Repository creation 新权限](https://github.blog/changelog/2026-10-13-github-app-improvements-for-least-privilege-and-management/)。
