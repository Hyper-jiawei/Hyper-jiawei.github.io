export const BASE = "/gallery";
export const withoutBase = (path: string) => path === BASE ? "/" : path.startsWith(BASE + "/") ? path.slice(BASE.length) : path;
// The site speaks three languages: Chinese (the original), English and Japanese. Everything
// the visitor reads as chrome — navigation, labels, counts, dates, screen-reader text — lives
// here; the photographs and album titles are the work itself and are never translated.

export const locales = ["zh", "en", "ja"] as const;
export type Lang = (typeof locales)[number];
export const defaultLang: Lang = "zh";

/** The value for <html lang>, and for hreflang links. */
export const langTag: Record<Lang, string> = { zh: "zh-CN", en: "en", ja: "ja" };

/** How each language names itself in the switcher. */
export const langName: Record<Lang, string> = { zh: "中文", en: "English", ja: "日本語" };

export const isLang = (value: string): value is Lang => (locales as readonly string[]).includes(value);

/** "/" for Chinese, "/en" or "/ja" for the others. */
export const prefix = (lang: Lang) => (lang === defaultLang ? "" : `/${lang}`);

/** A site path in the given language: localePath("en", "/categories/") → "/en/categories/". */
export const localePath = (lang: Lang, path: string) => `${BASE}${prefix(lang)}${path}`;

export const homePath = (lang: Lang) => localePath(lang, "/");
export const categoriesPath = (lang: Lang) => localePath(lang, "/categories/");
export const albumPath = (lang: Lang, slug: string) => localePath(lang, `/${slug}/`);
export const categoryPath = (lang: Lang, name: string) => localePath(lang, `/categories/${name.toLowerCase()}/`);

/** The same page in another language: localeSwitch("/en/categories/", "ja") → "/ja/categories/". */
export function localeSwitch(pathname: string, lang: Lang) {
  const clean = withoutBase(decodeURI(pathname));
  const first = clean.split("/")[1];
  const rest = isLang(first) && first !== defaultLang ? clean.slice(first.length + 1) : clean;
  if (/^\/404(?:\.html|\/)?$/.test(rest)) return `${BASE}${prefix(lang)}/`;
  return `${BASE}${prefix(lang)}${rest || "/"}`;
}

/** A festive mark's name in this language, falling back to the Chinese name. */
export const markName = (name: string, lang: Lang) => ui[lang].egg.marks[name] ?? name;

const CN_DIGIT: Record<string, number> = {
  正: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 腊: 12,
};

const cnNumber = (text: string): number | null => {
  if (/^\d+$/.test(text)) return Number(text);
  if (text.startsWith("初")) return CN_DIGIT[text.slice(1)] ?? null;
  if (text === "十五") return 15;
  if (text === "二十") return 20;
  if (text.startsWith("廿")) return 20 + (CN_DIGIT[text.slice(1)] ?? 0);
  return CN_DIGIT[text] ?? null;
};

const EN_MONTH = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ordinal = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${tail}`;
};

/** A mark's date in this language — "2月4日前后", "农历九月初九" and the like. */
export function markWhen(when: string, lang: Lang): string {
  if (lang === "zh") return when;
  const solar = when.match(/^(\d+)月(\d+)日(前后)?$/);
  if (solar) {
    const [, m, d, about] = solar;
    return lang === "ja"
      ? `${m}月${d}日${about ? "ごろ" : ""}`
      : `${Number(d)} ${EN_MONTH[Number(m)]}${about ? " (approx.)" : ""}`;
  }
  const lunar = when.match(/^农历(\S+?)月(.+)$/);
  if (lunar) {
    const [, monthText, dayText] = lunar;
    const month = cnNumber(monthText);
    if (dayText === "最后一天") {
      return lang === "ja" ? "旧暦の年末" : "last day of the lunar year";
    }
    const day = cnNumber(dayText);
    if (month && day) {
      return lang === "ja"
        ? `旧暦${month}月${day}日`
        : `${ordinal(day)} day of the ${ordinal(month)} lunar month`;
    }
  }
  return when;
}

/** The language a path belongs to. */
export function langOf(pathname: string): Lang {
  const first = withoutBase(pathname).split("/")[1];
  return isLang(first) ? first : defaultLang;
}

type Dict = {
  /** <html lang> is enough to tell the client scripts which strings to use. */
  meta: { description: string; bio: string };
  nav: { works: string; categories: string; blog: string; home: string; main: string; theme: string };
  home: {
    hero: string;
    featured: string;
    recent: string;
    index: string;
    all: string;
    filter: string;
    albums: (n: number) => string;
    /** The bare noun, for the year headings: "12 frames" is written around the number. */
    albumsUnit: string;
    frames: (n: number) => string;
  };
  categories: {
    eyebrow: string;
    title: string;
    description: string;
    count: (albums: number, photos: number) => string;
    others: string;
  };
  album: {
    back: string;
    top: string;
    prev: string;
    next: string;
    flip: string;
    scroll: string;
    end: string;
    series: string;
    photoInfo: string;
    scrollInfo: string;
    palette: string;
    paletteAria: (colors: string) => string;
    miniPaletteAria: (colors: string) => string;
    frames: (n: number) => string;
    photos: (n: number) => string;
    description: (title: string, date: string, photos: number) => string;
  };
  category: {
    description: (name: string, albums: number) => string;
  };
  footer: { friends: string; elsewhere: string; home: string; about: string; language: string };
  notFound: { title: string; heading: string; body: string; home: string };
  egg: {
    title: string;
    description: string;
    eyebrow: string;
    prev: string;
    next: string;
    all: string;
    kinds: Record<string, string>;
    /** Chinese name → this language's name; empty for Chinese itself. */
    marks: Record<string, string>;
  };
  lightbox: {
    close: string;
    error: string;
    download: string;
    zoomIn: string;
    zoomOut: string;
    states: { waiting: string; loading: string; decoding: string; ready: string; error: string };
  };
  /** Display names for the content's categories; unknown ones are shown as they are. */
  categoriesNamed: Record<string, string>;
};

// Editorial English retained in the Chinese design stays identical in every locale.
const editorialEnglish = {
  bio: "Documenting life in frames.",
  index: "Index",
  albums: (n: number) => `${n} albums`,
  albumsUnit: "albums",
  frames: (n: number) => `${n} frames`,
  themes: "Index of themes",
  count: (albums: number, photos: number) => `${albums} albums · ${photos} frames`,
  palette: "Palette",
  friends: "Friends",
  elsewhere: "Elsewhere",
  seasons: "Seasons",
};

export const ui: Record<Lang, Dict> = {
  zh: {
    meta: { description: "这里是 Hyper 的摄影画册", bio: editorialEnglish.bio },
    nav: { works: "作品", categories: "分类", blog: "博客", home: "首页", main: "主导航", theme: "切换浅色/深色模式（D）" },
    home: {
      hero: "精选相册",
      featured: "精选",
      recent: "近作",
      index: editorialEnglish.index,
      all: "全部",
      filter: "按分类筛选",
      albums: editorialEnglish.albums,
      albumsUnit: editorialEnglish.albumsUnit,
      frames: editorialEnglish.frames,
    },
    categories: {
      eyebrow: editorialEnglish.themes,
      title: "分类",
      description: "按主题浏览 Hyper 的摄影作品",
      count: editorialEnglish.count,
      others: "其他分类",
    },
    album: {
      back: "返回",
      top: "返回顶部",
      prev: "上一张",
      next: "下一张",
      flip: "翻页",
      scroll: "向下浏览",
      end: "终",
      series: "组图",
      photoInfo: "照片信息",
      scrollInfo: "滚动照片信息",
      palette: editorialEnglish.palette,
      paletteAria: (colors) => `照片主色：${colors}`,
      miniPaletteAria: (colors) => `主色：${colors}`,
      frames: editorialEnglish.frames,
      photos: (n) => `${n} 张照片`,
      description: (title, date, photos) => `${title} · ${date} · ${photos} 张照片`,
    },
    category: { description: (name, albums) => `${name} · ${albums} 个相册` },
    footer: { friends: editorialEnglish.friends, elsewhere: editorialEnglish.elsewhere, home: "回到首页", about: "关于我", language: "语言" },
    notFound: {
      title: "页面不存在",
      heading: "这里只有海带条",
      body: "这个地址没有对应的页面：链接可能已经失效、页面已被移除，或者地址拼写有误。",
      home: "回到首页",
    },
    egg: {
      title: "节气与节日",
      description: "节气与节日的 logo 装饰",
      eyebrow: editorialEnglish.seasons,
      prev: "上一个",
      next: "下一个",
      all: "全部图标",
      kinds: { term: "节气", festival: "节日", birthday: "生日" },
      marks: {},
    },
    lightbox: {
      close: "关闭",
      error: "图片加载失败",
      download: "下载原图",
      zoomIn: "放大",
      zoomOut: "缩小",
      states: {
        waiting: "等待加载原图",
        loading: "正在加载原图",
        decoding: "正在解码原图",
        ready: "原图已加载",
        error: "原图加载失败，仍可下载原图",
      },
    },
    categoriesNamed: { 人文: "人文", 风光: "风光", 寻轨迹: "寻轨迹", 寻航迹: "寻航迹", 星空: "星空", 静物: "静物" },
  },

  en: {
    meta: { description: "Hyper's photography, collected in albums", bio: editorialEnglish.bio },
    nav: { works: "Works", categories: "Categories", blog: "Blog", home: "Home", main: "Main", theme: "Switch between light and dark (D)" },
    home: {
      hero: "Featured albums",
      featured: "Featured",
      recent: "Recent",
      index: editorialEnglish.index,
      all: "All",
      filter: "Filter by category",
      albums: editorialEnglish.albums,
      albumsUnit: editorialEnglish.albumsUnit,
      frames: editorialEnglish.frames,
    },
    categories: {
      eyebrow: editorialEnglish.themes,
      title: "Categories",
      description: "Browse Hyper's photography by theme",
      count: editorialEnglish.count,
      others: "Other categories",
    },
    album: {
      back: "Back",
      top: "Back to top",
      prev: "Previous",
      next: "Next",
      flip: "Paging",
      scroll: "Scroll down",
      end: "End",
      series: "Series",
      photoInfo: "Photo details",
      scrollInfo: "Scroll the photo details",
      palette: editorialEnglish.palette,
      paletteAria: (colors) => `Photo colours: ${colors}`,
      miniPaletteAria: (colors) => `Colours: ${colors}`,
      frames: editorialEnglish.frames,
      photos: (n) => `${n} photos`,
      description: (title, date, photos) => `${title} · ${date} · ${photos} photos`,
    },
    category: { description: (name, albums) => `${name} · ${albums} albums` },
    footer: { friends: editorialEnglish.friends, elsewhere: editorialEnglish.elsewhere, home: "Back to the home page", about: "About me", language: "Language" },
    notFound: {
      title: "Page not found",
      heading: "Nothing on this roll",
      body: "There's no page at this address: the link may be broken, the page may have been taken down, or the address may be mistyped.",
      home: "Back to the gallery",
    },
    egg: {
      title: "Solar terms & festivals",
      description: "The wordmark's seasons and festivals, one mark at a time",
      eyebrow: editorialEnglish.seasons,
      prev: "Previous",
      next: "Next",
      all: "All marks",
      kinds: { term: "Solar term", festival: "Festival", birthday: "Birthday" },
      marks: {
        春分: "Vernal equinox",
        清明: "Clear and bright",
        谷雨: "Grain rain",
        立夏: "Start of summer",
        小满: "Grain buds",
        芒种: "Grain in ear",
        夏至: "Summer solstice",
        小暑: "Minor heat",
        大暑: "Major heat",
        立秋: "Start of autumn",
        处暑: "End of heat",
        白露: "White dew",
        秋分: "Autumn equinox",
        寒露: "Cold dew",
        霜降: "Frost's descent",
        立冬: "Start of winter",
        小雪: "Minor snow",
        大雪: "Major snow",
        冬至: "Winter solstice",
        小寒: "Minor cold",
        大寒: "Major cold",
        立春: "Start of spring",
        雨水: "Rain water",
        惊蛰: "Awakening of insects",
        元旦: "New Year's Day",
        情人节: "Valentine's Day",
        劳动节: "Labour Day",
        儿童节: "Children's Day",
        美国独立日: "Independence Day",
        国庆: "National Day",
        双十节: "Double Ten Day",
        万圣节: "Halloween",
        圣诞节: "Christmas",
        春节: "Spring Festival",
        元宵: "Lantern Festival",
        端午: "Dragon Boat Festival",
        七夕: "Qixi",
        中秋: "Mid-Autumn Festival",
        重阳: "Double Ninth Festival",
        腊八: "Laba Festival",
        除夕: "New Year's Eve",
        生日: "Birthday",
      },
    },
    lightbox: {
      close: "Close",
      error: "The image couldn't be loaded",
      download: "Download the original",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      states: {
        waiting: "Waiting for the original",
        loading: "Loading the original",
        decoding: "Decoding the original",
        ready: "Original loaded",
        error: "The original didn't load — you can still download it",
      },
    },
    categoriesNamed: { 人文: "Humanities", 风光: "Landscape", 寻轨迹: "Railways", 寻航迹: "Aviation", 星空: "Night sky", 静物: "Still life" },
  },

  ja: {
    meta: { description: "Hyper の写真をアルバムにまとめたギャラリー", bio: editorialEnglish.bio },
    nav: { works: "作品", categories: "カテゴリー", blog: "ブログ", home: "ホーム", main: "メインナビゲーション", theme: "ライト／ダークを切り替える（D）" },
    home: {
      hero: "注目のアルバム",
      featured: "注目",
      recent: "最新",
      index: editorialEnglish.index,
      all: "すべて",
      filter: "カテゴリーで絞り込む",
      albums: editorialEnglish.albums,
      albumsUnit: editorialEnglish.albumsUnit,
      frames: editorialEnglish.frames,
    },
    categories: {
      eyebrow: editorialEnglish.themes,
      title: "カテゴリー",
      description: "テーマから Hyper の写真をたどる",
      count: editorialEnglish.count,
      others: "ほかのカテゴリー",
    },
    album: {
      back: "戻る",
      top: "ページ上部へ",
      prev: "前へ",
      next: "次へ",
      flip: "ページ送り",
      scroll: "下へスクロール",
      end: "終",
      series: "連作",
      photoInfo: "写真情報",
      scrollInfo: "写真情報をスクロール",
      palette: editorialEnglish.palette,
      paletteAria: (colors) => `写真の主要色：${colors}`,
      miniPaletteAria: (colors) => `主要色：${colors}`,
      frames: editorialEnglish.frames,
      photos: (n) => `${n} 枚`,
      description: (title, date, photos) => `${title}・${date}・${photos} 枚`,
    },
    category: { description: (name, albums) => `${name}・${albums} アルバム` },
    footer: { friends: editorialEnglish.friends, elsewhere: editorialEnglish.elsewhere, home: "ホームに戻る", about: "プロフィール", language: "言語" },
    notFound: {
      title: "ページが見つかりません",
      heading: "この巻は空でした",
      body: "このアドレスに該当するページはありません。リンクが古くなっているか、ページが削除されたか、URL の綴りが違うのかもしれません。",
      home: "ホームへ戻る",
    },
    egg: {
      title: "節気と年中行事",
      description: "ロゴに宿る節気と年中行事のしるし",
      eyebrow: editorialEnglish.seasons,
      prev: "前へ",
      next: "次へ",
      all: "すべてのしるし",
      kinds: { term: "節気", festival: "年中行事", birthday: "誕生日" },
      marks: {
        春分: "春分",
        清明: "清明",
        谷雨: "穀雨",
        立夏: "立夏",
        小满: "小満",
        芒种: "芒種",
        夏至: "夏至",
        小暑: "小暑",
        大暑: "大暑",
        立秋: "立秋",
        处暑: "処暑",
        白露: "白露",
        秋分: "秋分",
        寒露: "寒露",
        霜降: "霜降",
        立冬: "立冬",
        小雪: "小雪",
        大雪: "大雪",
        冬至: "冬至",
        小寒: "小寒",
        大寒: "大寒",
        立春: "立春",
        雨水: "雨水",
        惊蛰: "啓蟄",
        元旦: "元旦",
        情人节: "バレンタインデー",
        劳动节: "メーデー",
        儿童节: "こどもの日",
        美国独立日: "独立記念日",
        国庆: "国慶節",
        双十节: "双十節",
        万圣节: "ハロウィン",
        圣诞节: "クリスマス",
        春节: "春節",
        元宵: "元宵節",
        端午: "端午の節句",
        七夕: "七夕",
        中秋: "中秋節",
        重阳: "重陽",
        腊八: "臘八",
        除夕: "大晦日",
        生日: "誕生日",
      },
    },
    lightbox: {
      close: "閉じる",
      error: "画像を読み込めませんでした",
      download: "オリジナルをダウンロード",
      zoomIn: "拡大",
      zoomOut: "縮小",
      states: {
        waiting: "原寸大を待っています",
        loading: "原寸大を読み込み中",
        decoding: "原寸大を展開中",
        ready: "原寸大を表示中",
        error: "原寸大を読み込めませんでした。ダウンロードはできます",
      },
    },
    categoriesNamed: { 人文: "人文", 风光: "風景", 寻轨迹: "鉄道", 寻航迹: "航空", 星空: "星空", 静物: "静物" },
  },
};

/** The strings for a language. */
export const t = (lang: Lang): Dict => ui[lang];

/** A category's display name: translated where a translation exists, otherwise as written. */
export const categoryName = (name: string, lang: Lang) => ui[lang].categoriesNamed[name] ?? name;

/** Dates: "2025 年 9 月 28 日" / "28 September 2025" / "2025年9月28日", or the dotted short form. */
export function formatDate(date: string | null, lang: Lang = defaultLang, style: "long" | "short" = "long") {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (style === "short") return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
  if (lang === "en") return `${d} ${MONTHS_EN[m - 1]} ${y}`;
  if (lang === "ja") return `${y}年${m}月${d}日`;
  return `${y} 年 ${m} 月 ${d} 日`;
}

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
