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

第一辑「忆秦娥·娄山关」已发布，原图和文案在 `gallery/content/2026-10-30-loushanguan/`。当前一辑 8 张照片，封面使用 `娄山关路.JPG`，首页目前选五张独立作品轮播；可通过每张照片的 `params.featured: true` 自由增减，数量不限。

**完整的手动更新步骤、YAML 模板、封面与精选配置、EXIF 和缩略图说明，见 [Gallery 维护指南](gallery/README.md)。** 这份指南也同步到 `Hyper-jiawei/hypers-gallery` 仓库的 README；线上实际发布仍由本仓库负责。

你可直接上传 6–10 MB 原图，无需手动压缩。支持 JPG、PNG、WebP、TIFF 及手机 HEIC / HEIF。自动流程生成 WebP 预览图及封面缩略图，保留原文件供下载；HEIC 另生成全像素 JPEG 用于浏览器放大，无需手动转换。照片标题取自文件名，点击专辑内照片进入独立详情页，显示拍摄日期、相机参数、色块和文案。注意整站发布体积仍受 1 GB 限制。

## 修改名称与个人资料

- 常用名 **Hyper**，长名称 **Hyper'jiawei**。
- Blog 基本信息：`src/lib/site.ts`。
- Blog 首屏和页脚点阵标题：`src/pages/index.astro`、`src/components/Footer.astro`。
- Blog 左上角字标：`src/components/Header.astro`（原样式 class 名保留）。
- Blog 三种语言文案：`src/lib/i18n.ts`。
- About 侧边资料：`src/pages/about.astro`；正文在 `src/content/pages/about*.md`。
- Gallery 基本信息：`gallery/site/src/site.config.ts`。
- Gallery 标志是原字体生成的 SVG 轮廓：脚本为 `gallery/site/scripts/build-wordmark.mjs`。本次已经生成 Hyper 标志、对齐彩蛋符号，并限制长字标在手机端不超出页面宽度，正常维护不要改动生成数据。
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
