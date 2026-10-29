# Hyper 网站维护说明

主站：https://hyper-jiawei.github.io/
画册：https://hyper-jiawei.github.io/gallery/

本版直接沿用你提供的 Astro Blog 和 Gallery 源码，保留组件、字体、样式、动画与交互。旧 Hugo 源码和朋友的文章、照片未搬入新站。此前的 `content.json` 静态方案已被本版替换，之后使用 Markdown 更新。

## 最常用的文件

```text
src/lib/site.ts                 站名、个人信息、导航和社交链接
src/content/pages/about*.md     中文 / 英文 / 日文的关于页
src/content/posts/              博客文章；每篇一文件夹
src/assets/avatar.png           个人头像
public/files/                  博客附件（自行上传）
gallery/content/               画册；每个相册一文件夹，照片也放这里
gallery/site/src/site.config.ts 画册个人信息、友链、社交账号
gallery/site/src/i18n/index.ts  画册三种语言界面文字与路径适配
scripts/assemble.mjs            合并发布产物
.github/workflows/pages.yml     自动构建、测试、部署
```

其余组件目录保留原框架组织，日常维护不必修改。`dist`、`node_modules`、`.astro`、`.cache` 和 `gallery/site/public/img` 都是自动生成文件，不提交。

## 新增文章

在 GitHub 本仓库中选择 **Add file → Create new file**，文件名填 `src/content/posts/my-first-post/index.md`。示例：

```markdown
---
title: "我的第一篇文章"
date: 2026-10-29
summary: "列表里显示的一句话介绍。"
tags: ["随记", "编程"]
author: Hyper
draft: false
---

正文从这里开始，使用 Markdown。

## 小标题

写下内容。
```

同一篇文章的封面放在该文件夹里，文件名用 `cover.jpg`（也支持 PNG / WebP / AVIF）。没有封面就留空，原框架会显示留白。正文图片可写 `![图片说明](./photo.jpg)`。文章文件夹名就是 URL 的 slug，发布后尽量不改名。

`draft: true` 为草稿，不会发布。`private: true` 只是隐藏列表和搜索，知道链接仍可访问；不要把它当作隐私保护。附件上传到 `public/files` 后，在正文中使用 `[下载附件](/files/example.pdf)`。

初始的项目文章根据你的公开仓库说明填写，欢迎替换成自己的长文；照片未虚构。

## 上传画册照片

画册目前有五个明确标注“待上传”的空白占位，保留原首页轮播、分类、灯箱和版式。你可以替换占位，也可以新建相册。

1. 在 `gallery/content/` 下创建文件夹，例如 `shanghai-walk`。
2. 上传 JPG / JPEG / PNG / WebP / TIFF 照片到这个文件夹。
3. 在同一文件夹创建 `index.md`：

```yaml
---
title: "上海散步"
date: 2026-10-29
categories: ["日常", "人文"]
featured: true
description: "一次散步的记录。"
resources:
  - src: photo-01.jpg
    params:
      cover: true
---
```

`featured: true` 为首页轮播候选，最多展示五辑；未设置时也可能被选为近作。相册内的照片自动读取、排序并生成 WebP 尺寸、缩略图和 EXIF。封面文件名须与 `resources` 中一致。移除占位时删除对应 `placeholder-*` 文件夹及 `blank.jpg`，或者直接替换照片和元数据；上传真实照片后删掉 `placeholder: true`。

单图布局：`layout: single-big-photo`；默认是多图画册。保留原框架的 `actual` 实际尺寸布局、颜色卡、缩放、原图下载等功能，详细说明见 `gallery/site/README.md`。

GitHub 网页单文件上传上限请以当时的 GitHub 界面为准；日常建议将照片长边控制在约 3000px，避免过大的原图。原图会随画册公开，并可下载；发布前检查 EXIF 中是否有不想公开的信息。

## 修改名称与个人资料

- 常用名 **Hyper**，长名称 **Hyper'jiawei**。
- Blog 基本信息：`src/lib/site.ts`。
- Blog 首屏和页脚点阵标题：`src/pages/index.astro`、`src/components/Footer.astro`。
- Blog 左上角字标：`src/components/Header.astro`（原样式 class 名保留）。
- Blog 三种语言文案：`src/lib/i18n.ts`。
- About 侧边资料：`src/pages/about.astro`；正文在 `src/content/pages/about*.md`。
- Gallery 基本信息：`gallery/site/src/site.config.ts`。
- Gallery 标志是原字体生成的 SVG 轮廓：脚本为 `gallery/site/scripts/build-wordmark.mjs`。本次已经生成 Hyper 标志并对齐彩蛋符号，正常维护不要改动生成数据。
- Gallery 的生日彩蛋默认未填个人生日；需要时将 `birthday: null` 改成 `{ month: 月, day: 日 }`。节日、节气和五连击彩蛋仍保留。

修改头像时替换 `src/assets/avatar.png` 和 `gallery/site/public/images/avatar.png`。GitHub 主页资料不会实时同步到网站；改资料后请手动更新上述文件。

## 保存与发布

提交到 `main` 后，**Actions → Deploy Hyper Blog and Gallery** 自动执行：

1. 安装两套原 Astro 项目的依赖。
2. 运行两套回归测试。
3. 构建 Blog 和 Pagefind 搜索索引。
4. 处理照片并构建 Gallery。
5. 合并为同一个站点：Blog 在 `/`，Gallery 在 `/gallery/`。
6. 发布到 GitHub Pages。

必须等 Actions 绿色成功。部署失败时旧网站保持可用，查看失败步骤的日志即可。初始 Pages 来源已为 GitHub Actions，不需要设置自定义域名或 `CNAME`。

## 本地运行

安装 Node.js 24（含 npm），进入本仓库：

```bash
npm ci
npm ci --prefix gallery/site
npm run dev
```

Blog 开发预览的搜索需要生产索引，完整验证请构建后预览：

```bash
npm test
npm test --prefix gallery/site
npm run build
npm run build --prefix gallery/site
node scripts/assemble.mjs
npm run preview
```

终端会显示访问地址。画册单独开发可用 `npm run dev --prefix gallery/site`，浏览器路径使用 `/gallery/`。两个项目共享主题存储，Blog 和 Gallery 切换时沿用同一明暗偏好。

## 保持原设计

`src/styles/global.css` 和 `gallery/site/src/styles/global.css` 保持来源原样；组件内的动画、间距、鼠标反馈和移动端规则也保留。不要为了更新内容修改这些文件。子路径适配集中在 Gallery 的 i18n 路径函数、Base/Header 路由判断，以及 `scripts/prefix-gallery.mjs`。

如需回退本次重构，使用 GitHub 历史中的对应提交进行 revert；不要强制覆盖历史。上一版发布提交为 `14451a84d7c8551b0bc18f032d179fd2b2ac299b`。
