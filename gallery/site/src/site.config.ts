const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");
const BLOG = import.meta.env.GALLERY_BLOG_ORIGIN ?? "";

export const site = {
  title: "Hyper's Gallery",
  description: "这里是 Hyper 的摄影画册",
  author: "Hyper'jiawei",
  bio: "Documenting life in frames.",
  avatar: `${BASE}/images/avatar.png`,
  aboutUrl: BLOG ? `${BLOG}/about/` : "/about/",
  blogUrl: BLOG ? `${BLOG}/` : "/",
  copyright: "Copyright © Hyper's Gallery 2026",
  birthday: null as { month: number; day: number } | null,
  friends: [],
  social: [
    { icon: "github", label: "GitHub", url: "https://github.com/Hyper-jiawei" },
    { icon: "email", label: "Email", url: "mailto:jiaweibai1201@outlook.com" },
  ],
} as const;
