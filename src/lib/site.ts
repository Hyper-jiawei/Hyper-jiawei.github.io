export const SITE = {
  title: "Hyper's Blog",
  handle: 'Hyper',
  author: "Hyper'jiawei",
  description: '代码、实践与生活记录 —— Hyper 的个人博客。',
  url: 'https://hyper-jiawei.github.io',
  topics: ['计算机视觉', '嵌入式开发', '自动化', '编程', '生活'],
};
export const GALLERY = { label: "Hyper's Gallery", href: '/gallery/', desc: '摄影作品集' };
export const NAV = [
  { href: '/posts/', label: '文章', slug: 'posts' },
  { href: '/tags/', label: '标签', slug: 'tags' },
  { href: '/about/', label: '关于', slug: 'about' },
];
export const SOCIALS = [
  { id: 'github', label: 'GitHub', href: 'https://github.com/Hyper-jiawei' },
  { id: 'email', label: 'Email', href: 'mailto:jiaweibai1201@outlook.com' },
] as const;
