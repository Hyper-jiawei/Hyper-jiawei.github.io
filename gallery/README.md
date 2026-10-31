# Hyper's Gallery

在线画册：https://hyper-jiawei.github.io/gallery/

## 先确认改哪个仓库

**线上网站的实际源码和照片位于 [Hyper-jiawei.github.io](https://github.com/Hyper-jiawei/Hyper-jiawei.github.io)，本仓库保留原始 Gallery 框架。只修改本仓库不会更新线上画册。**

- [专辑与原图目录](https://github.com/Hyper-jiawei/Hyper-jiawei.github.io/tree/main/gallery/content)
- [第一辑示例](https://github.com/Hyper-jiawei/Hyper-jiawei.github.io/tree/main/gallery/content/2026-10-30-loushanguan)
- [网站发布记录](https://github.com/Hyper-jiawei/Hyper-jiawei.github.io/actions)
- [完整维护说明](https://github.com/Hyper-jiawei/Hyper-jiawei.github.io/blob/main/MAINTENANCE.md)

## 本地一键发布（推荐）

在网站源码目录双击 **「打开 Gallery 发布工具.command」**，选择原图文件夹，填写文案、封面和精选后生成配置，再点击发布。默认 `description: ""`，不生成 `featured`；只有勾选「首页精选」才写入 `featured: true`。无需手动上传原图或提交文件。

详见 [本地发布工具使用说明](https://github.com/Hyper-jiawei/Hyper-jiawei.github.io/blob/main/tools/gallery-publisher/README.md)。

## 下一期专辑怎么更新

1. 在网站源码仓库的 `gallery/content/` 下新建文件夹，例如 `2026-11-08-shanghai`。
2. 将 JPG / JPEG / PNG / WebP / TIFF / HEIC / HEIF 原图放进该文件夹，与 `index.md` 放在同一级。可直接上传 6–10 MB 的原图，不用手工压缩。日常用 GitHub 网页上传或 GitHub Desktop 提交。
3. **照片文件名就是照片标题**，例如 `雨夜.JPG`，页面标题为「雨夜」。文件名可以包含中文和空格；请避免斜杠、问号、井号、百分号等 URL 特殊字符。
4. 在同一个文件夹创建 `index.md`，复制以下模板并替换内容。
5. 提交到网站仓库 `main`，等待 Actions 的 **Deploy Hyper Blog and Gallery** 变绿，再查看网站。

```yaml
---
title: "第二辑 · 上海散步"
date: 2026-11-08
categories: ["人文", "街拍"]
featured: true
showPalette: true
description: "2026 年 11 月 8 日，上海街头散步。"
resources:
  - src: "雨夜.JPG"
    params:
      cover: true
      featured: true # 精选照片
      description: |
        这张照片的文案写在这里。
        可以换行继续写。
  - src: "路灯.JPG"
    params:
      featured: true # 精选照片
      description: "这张照片的文案。"
---
```

## 封面、首页精选轮播和照片文案

- `title`：专辑标题；`description`：专辑简介（可省略）；`date`：专辑日期。
- `resources[].src`：与原图文件名完全一致，包含扩展名和大小写。
- `params.cover: true`：专辑列表封面，一辑指定一张。第一辑使用「娄山关路.JPG」。
- **首页轮播由每张照片的 `params.featured` 控制，不限制五张。** 在任意专辑的一张照片下写 `featured: true`，该照片就加入轮播；写 `featured: false` 或不写则不加入。也支持 `featured: "精选照片"`，含义相同。
- 可以选 1 张、5 张、11 张或更多。公开专辑中所有选中的照片都会显示，按专辑日期从新到旧、同一专辑按 `resources` 顺序排列。
- 兼容原来的 `featured: 1`、`featured: 2` 等正数，同一专辑按数字排序；不再截取前五张。未选中任何照片时不显示首页轮播，专辑列表照常显示。
- 专辑顶层的 `featured` 可省略；它不会自动选中该辑的全部照片。实际入选只看对应图片 `params` 中的 `featured`。
- `params.description`：该照片的文案（可省略），显示在独立照片详情页。多行文案使用 `|`，下一行缩进六个空格。
- 照片按 `resources` 中的顺序展示；未列出的照片也会被收录，并排在后面。隐藏照片可设 `params.hidden: true`，但不要把它当成敏感原图的隐私保护。
- 修改已发布的专辑目录名或图片文件名，会改变详情页网址，尽量保持稳定。

## 缩略图、相机参数和色块

**不用自己制作或上传缩略图，也不用手工填写相机参数。** 自动发布时，系统会：

1. 读取原图 EXIF，包括拍摄日期、相机、镜头、焦距、光圈、快门、ISO。
2. 生成最长边 480 / 960 / 1600 / 2200 / 3000 像素的 WebP 预览图（不放大小图）。
3. 为专辑封面生成多尺寸缩略图，浏览器按屏幕尺寸选择合适文件。
4. 从每张照片提取四个色块；`showPalette: true` 同时开启专辑照片下方的小色卡。
5. 生成每张照片的独立详情页，沿用原框架的单图展陈布局，显示文件名标题、拍摄日期、参数、色块和文案。
6. 保留上传原图的字节内容供下载；HEIC / HEIF 另外生成全像素 JPEG 用于浏览器放大，其余格式继续使用原图放大。

如果导出软件去掉了 EXIF，相机参数无法凭空恢复；请导出时保留拍摄信息。缺失的参数不会伪造，日期缺失则使用专辑日期。

自动产物 `gallery/site/public/img/`、`gallery/site/src/data/gallery.json`、`dist/`、`.cache/` 不需要编辑或提交，也不要把它们当作原图上传目录。

## 直接上传手机 HEIC / HEIF

与 JPG 一样，将 `.heic` / `.HEIC` / `.heif` 文件放入专辑文件夹，`resources.src` 填实际文件名，例如 `夜色.HEIC`。**不用先转 JPG，也不用安装额外的系统转换工具。** 提交后 GitHub Actions 自动完成转换。

- 标题仍取文件名，文案和封面配置方法完全相同。
- EXIF 从 HEIC 原文件读取，不从转换图猜测；没有写入文件的参数不会补造。
- 网页、轮播、缩略图使用 WebP；放大使用同像素尺寸的 JPEG，兼容不能显示 HEIC 的浏览器。
- 下载按钮取得未改写的 HEIC 原文件，文件名及扩展名保留。
- HEIC 容器仅取一张主静态照片，不会把深度图、辅助图或 Live Photo 视频当成额外作品。
- HEIC 的 HDR / 高位深原始信息以原文件为准；网页转换图是普通显示用的静态预览。
- 解码失败会让构建报错并指出文件名，避免照片悄悄漏掉；旧站点保持可用。

## 原图存放与容量

当前原图与专辑文案统一放在网站源码仓库的 `gallery/content/<专辑目录>/`，第一辑 8 张原图约 42 MB。现阶段不新建私人照片仓库，减少跨仓库凭据与同步维护。

网站源码公开，发布后的原图也可公开查看和下载；原始 EXIF 可能包含位置等信息，上传前自行确认。私人仓库即使参与构建，也不能让最终公开发布的原图保持私密。

GitHub Pages 的整个发布站点（博客、Gallery、原图和预览图）上限为 1 GB。原图会额外生成多个预览文件，因此不能按原图总量直接计算剩余容量。接近容量时再迁移图片存储；不要把 GitHub 当作唯一原片备份。

## 本地检查

安装 Node.js 24 和 npm，在 **网站源码仓库** 中执行：

```bash
npm ci
npm ci --prefix gallery/site
npm test
npm test --prefix gallery/site
npm run build
npm run build --prefix gallery/site
node scripts/assemble.mjs
npm run preview
```

单独预览 Gallery：`npm run dev --prefix gallery/site`，访问终端显示地址下的 `/gallery/`。

发布失败时查看 Actions 日志，先检查 YAML 缩进、文件名大小写及图片格式。旧网站在新部署成功前保持可用。

