# 网站维护说明

网站地址：https://hyper-jiawei.github.io/

日常更新主要修改 `content.json`。无需安装 Node、Ruby 或 Jekyll；发布由 GitHub Actions 自动完成。这个仓库是公开的，上传的文件会随站点公开。

## 1. 文件夹只需要认识这些

```text
Hyper-jiawei.github.io/
├── content.json             # 个人信息、首页文字、项目、画册、随记
├── index.html               # 页面结构（一般不用改）
├── assets/
│   ├── photos/              # 上传照片、封面
│   ├── files/               # 上传 PDF 等附件
│   ├── style.css            # 配色、排版、手机适配
│   ├── app.js               # 筛选、弹窗、主题等交互
│   └── favicon.svg          # 网站图标
├── README.md                # 对外的个人介绍，也用于 GitHub 个人主页
├── MAINTENANCE.md           # 本说明
├── check.py                 # 内容与文件路径检查、整理发布文件
├── .github/workflows/pages.yml  # 自动部署
└── 其他支持文件              # 404、搜索引擎、旧缓存迁移、许可证
```

网站改版前的模板、文章和图片仍可从 Git 历史查看。原始版本提交为 `fa39f5e0813e70a952015495bd4d6063e839129f`，无需再把旧版文件放在当前目录。

## 2. 在 GitHub 网页直接更新信息

1. 打开本仓库，进入 `content.json`，点击铅笔 **Edit this file**。
2. 修改 `profile` 下对应字段，保留英文双引号和逗号。
3. 将 `updated` 改成实际更新日期，例如 `2026-10-29`。
4. 点击 **Commit changes**，保存到 `main`。也可以先建分支，检查后合并。
5. 打开 **Actions → Deploy personal collection**，等到绿色成功；GitHub Pages 和浏览器缓存可能还需要几分钟刷新。

字段对应：

| 字段 | 含义 |
| --- | --- |
| `name` / `nameEn` | 中文姓名 / 英文姓名；浏览器标题也使用 `name` |
| `username` / `github` | GitHub 用户名 / 主页完整链接 |
| `bio` | 个人签名 |
| `intro` | 关于区域的一段介绍 |
| `location` / `organization` | 所在地 / 关联机构；空字符串会隐藏该条 |
| `interests` | 兴趣方向列表，例如 `["计算机视觉", "自动化工具"]` |
| `email` | 联系邮箱；默认留空，填写后才显示 Email 入口 |
| `updated` | 最后维护日期，格式为 `YYYY-MM-DD` |
| `avatar` | GitHub 头像记录；当前排版不展示头像，留作后续使用 |

资料来源为你的 GitHub 公开主页和公开项目列表；兴趣方向根据公开项目归纳，不代表学历、职位或专业认证。机构字段保留主页原文，没有推断就读或任职关系。项目日期使用仓库创建日期。网站不会实时调用 GitHub API；主页资料更改后需手动更新此文件。

`featured` 控制首屏：`title` 用 `\n` 换行，`subtitle` 为副标题。`image` 为空时显示留白，填 `assets/photos/hero.webp` 即展示首屏照片；同时填写 `alt` 图片说明。首屏底部的署名和城市位于 `index.html`，如姓名或城市发生变化，也修改其中 `hero-foot` 的文字。搜索引擎介绍位于 `index.html` 的 description。

## 3. 上传图片和附件

1. 在 GitHub 中进入 `assets/photos`，选择 **Add file → Upload files**，拖入图片并提交。
2. PDF、压缩包等资料放进 `assets/files`，操作相同。
3. 再编辑 `content.json`，填写文件路径。路径使用 `/`，建议全小写英文名，如 `assets/photos/shanghai-01.webp`。
4. 只上传文件不会自动生成画册或下载入口，必须在内容中登记路径。

图片建议用 WebP/JPG，长边约 2000px，单张尽量控制在 1MB 以内。不要上传带敏感信息、无公开授权或大体积原始素材的文件。附件名称、文件扩展名和大小写要与路径一致。

## 4. 新增或替换画册

`albums` 是数组。当前的“第一本画册”是明确的空白占位，可直接替换或删掉整个对象。实际发布的画册示例：

```json
{
  "id": "shanghai-2026",
  "title": "上海散步",
  "date": "2026-10-29",
  "category": "日常 · 城市",
  "description": "散步时拍下的片段。",
  "cover": "assets/photos/shanghai-01.webp",
  "photos": [
    {
      "src": "assets/photos/shanghai-01.webp",
      "alt": "傍晚的街道",
      "caption": "写在照片下方的一句话。"
    },
    {
      "src": "assets/photos/shanghai-02.webp",
      "alt": "街边的一棵树",
      "caption": ""
    }
  ],
  "files": [
    { "name": "下载画册 PDF", "url": "assets/files/shanghai.pdf" }
  ]
}
```

示例中的文件需要自行上传后才可使用。没有附件就用 `"files": []`；没有照片就用 `"photos": []`，封面留 `"cover": ""`。空日期归入“待续”，有日期按年份归档、倒序排列。每条 `id` 必须唯一。

## 5. 新增项目

在 `projects` 数组添加以下对象，与前一条之间用逗号分隔：

```json
{
  "id": "my-new-project",
  "title": "项目名称",
  "date": "2026-10-29",
  "category": "自动化 · Python",
  "description": "用一两句话说明它解决什么问题。",
  "url": "https://github.com/Hyper-jiawei/项目仓库名",
  "cover": "",
  "language": "Python",
  "files": []
}
```

`cover` 留空时显示代码占位符；填写已上传图片路径即可展示项目截图。项目卡片跳转 `url`，附件在卡片下方单独显示。分类和数量由数据自动计算。

## 6. 写一条随记

将 `notes: []` 改为实际条目数组；已存在条目时继续追加：

```json
"notes": [
  {
    "title": "一次小更新",
    "date": "2026-10-29",
    "text": "记录今天做了什么。\n第二段文字。",
    "url": "",
    "files": []
  }
]
```

`text` 为纯文本，使用 `\n` 换行；不会执行 HTML。填写 `url` 后出现“继续阅读”入口。附件格式与画册一致。

## 7. 本地预览和检查

电脑安装 Python 3.9 或以上版本后，在仓库目录执行：

```bash
python3 check.py --prepare
python3 -m http.server 8000 --directory _site
```

浏览器打开 http://localhost:8000/ 。不要直接双击 `index.html`：浏览器通常会限制 `file://` 页面读取 JSON。终端按 `Ctrl+C` 停止预览。

`check.py` 会检查 JSON 格式、必填项、日期、ID 重复和本地文件是否存在。检查失败时不会进入发布步骤。发布目录 `_site` 自动生成，不要手动维护，也不要提交。

首次发布请在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。以后提交 `main` 会自动部署。网站不使用自定义域名；已移除原模板指向 `huangxuan.me` 的 `CNAME`，请勿恢复。

常见问题：

- **页面显示内容无法加载**：检查 JSON 是否少了逗号、用了中文引号、或末尾多了逗号。在 Actions 中查看校验报错。
- **图片不显示**：先确认已上传，再核对扩展名、大小写和路径；不要写本机磁盘路径。
- **修改后还是旧页面**：先确认最新 Actions 成功，再强制刷新（macOS `⌘⇧R`）。`sw.js` 仅用于清理旧模板缓存，暂时保留。
- **部署失败**：查看对应 Actions 日志。默认分支需保持 `main`；检查 Pages 是否启用 Actions 来源。
- **想恢复旧版**：从历史查看旧文件，或将改版提交 revert 后重新部署；不要强制覆盖远端历史。旧版仍带模板作者资料和域名配置，恢复前需另行修正。

## 8. GitHub 个人主页 README

GitHub 个人主页显示的是 **同名公开仓库** `Hyper-jiawei/Hyper-jiawei` 根目录的 `README.md`，不是网站仓库的 README。

本仓库的 `README.md` 已写成适合个人主页的介绍，所有链接都是完整地址，可以原样复制到同名仓库。维护说明独立放在本文件，个人主页不需要展示大量部署内容。

两边是独立仓库，GitHub 不会自动同步。改介绍后，把最终 README 同时更新到两个仓库；只改网站数据不会改 README。若同名仓库尚未建立：点击 GitHub **New repository**，仓库名填 `Hyper-jiawei`，选择 Public 并添加 README，然后替换为本仓库 README 内容。

## 9. 设计来源与许可

视觉参考 [Nit's Gallery](https://gallery.3nit.icu/) 的纸色、细线、大字号、编号和年份归档。查看了其公开 HTML/CSS 及作者公开仓库列表；未找到可直接使用的画册源码仓库，因此本站以原生 HTML/CSS/JavaScript 独立实现。没有复制作者摄影、品牌标识或字体文件。

旧模板来自 Hux Blog，原 Apache 2.0 许可证保留在 `LICENSE`，相关来源记录见 `NOTICE`。个人照片与附件的权利归各自权利人。
