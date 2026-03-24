# 泡泡·桌面端·Demo

如流，让你的思绪流动：

<img width="2200" height="1384" alt="image" src="https://github.com/user-attachments/assets/b7b6992b-9bc2-45d0-a495-fb97e5f82458" />

分箱，把信息放对地方：

<img width="2200" height="1430" alt="image" src="https://github.com/user-attachments/assets/9f22cf3d-5e16-4991-93a8-f5e491396e9a" />


## 为什么要做

整理思绪的小工具。不是笔记，不止于待办，甚至能让AI去办。面对选择困难，缓解注意瘫痪。

常见的笔记软件假设：

1. 很多笔记是有“长期价值”的。（一月不看一次的，到底有什么价值呢？会生利息吗？）；
2. 用户时常会“主动整理”；
3. “协同”、“办公”更重要。从商业角度是这样，但对个人，太重型。

这款软件假设：

- 大部分信息作用不大，信息价值随时间极速衰减；
- 有效信息在不同地方，发挥的作用完全不同，但大部分用户不会时常主动整理文件夹；
- 优先管好自己。

## 怎么做的

一个纯Codex开发的桌面端应用，二十美金账户两周额度。大部分只用自然语言提需求，[主要的涉及代码的人工干预](#主要的涉及代码的人工干预)见文档附录。

起点是一张图跟对应单页网页代码，基本实现了「如流」，但大部分需求都不确定。

## 现在做成怎样？

整体是能用水平，相当于MVP。AI功能未完全引入。开发、测试均在Mac上

### 如流

> 激发表达欲，让思绪流动

泡泡有点像社交媒体消息，设计上能转发、评论，还能比较自由组织图文。

「如流」类似聊天流，参考了Discord、微信传输助手的设计。让用户随心输入，至于格式、整理之类，后面再说。

同时，聊天流天然与时间强相关，能很好发挥时间筛选信息的功能。[参考“拖延不酷但有用”](https://weibo.com/6083767801/5279657777430725)。

还有一些设计取舍，比如：

- 如流设计上是没有编辑功能的，用户专注于现在的输出，不用想着修改以前的。不过，AI在某次修复编辑问题的时候顺手加上了。
- 目前搜索，貌似不是必要需求。我自用，建了两千多个泡泡，没用过搜索。

> Codex GPT 5.4: 我就在这里，稳稳接住你。

> TODO: Markdown格式渲染有问题，需要调整。

### 分箱

> 把有效信息放对地方

「如流」中的一些「泡泡」，不想被时间冲走，怎么办？可以把它们放到泡泡箱。也就是「分箱」页面要解决这个问题。

你可以创建不同箱子，将泡泡放对地方。目前类似看板。如果泡泡太多、太杂，还能考虑分层。

### 工厂

目前就是配置「泡泡机」的地方。目前能把「泡泡机」放到「如流」对话，或者直接把某个泡泡发往某个「泡泡机」，让它执行。

<img width="2200" height="1438" alt="image" src="https://github.com/user-attachments/assets/041b6384-09ba-4cd3-a4cc-75c07b6db943" />


直接在「泡泡」记录「泡泡」的需求，然后发往Codex让它直接改，有种“自己改自己”的感觉。当然，生成上估计最多做到“改插件”，毕竟就算只改渲染进程也容易崩溃，丢失当前输入信息。

<img width="2200" height="1384" alt="image" src="https://github.com/user-attachments/assets/d98162f6-185d-4058-9ac4-b6658b5c7e96" />


> 话说，前阵子龙虾爆火（OpenClaw），我还犹豫过要不要给泡泡机改名，毕竟龙虾也会吐泡泡。

### 接下来

功能上：

- 合成大泡泡。「如流」的一些泡泡；
- 挖掘好泡泡。有段时间光顾着叭叭，也没有精力整理……
- 价值天平。让泡泡上自己价值观的称，让大模型辅助判断接下来做什么好；
- 手机直发「如流」；
- ……

设计上：

- 梳理数据。存储、（内存中）状态与流转；
- 更精细的UI/UX设计；
- 更成熟的架构。

## 自行构建

### 环境准备

开始之前，先准备：

- Node.js (推荐v22以上)
- npm

项目当前主要在 Mac 上开发和测试。

### 安装依赖

先在项目根目录安装依赖：

```bash
npm install
````

### 开发模式

开发模式直接运行：

```bash
npm run dev
```

这个命令会启动基于 Vite 的开发环境。仓库里 `dev` 脚本实际执行的是 `vite --config vite.config.mjs`；同时，`vite.config.mjs` 里额外接了 Electron 的开发插件，会在开发时构建并监听 `main` / `preload`，主进程改动后重启 Electron，预加载改动后触发页面刷新。默认开发服务器地址是 `127.0.0.1:5180`，并开启了 `strictPort`  。

### 类型检查

这个项目带了单独的类型检查命令：

```bash
npm run typecheck
```

对应的是 `tsc --project tsconfig.json --noEmit`，适合在提交前快速检查一遍类型问题 。

### 构建

构建产物（不是打包成App）使用：

```bash
npm run build
```

这里的 `build` 脚本执行的是 `vite build --config vite.config.mjs`。除了打包渲染层，`vite.config.mjs` 里的 `closeBundle()` 还会继续构建 `main` 和 `preload`，最终渲染层输出到 `dist/renderer`，主进程入口则是 `dist/main/index.js` 。

### 运行构建后的应用

仓库里还有一个：

```bash
npm run start
```

它实际执行的是：

```bash
electron .
```

### 打包

如果你想生成可分发的桌面应用目录，可以使用：

```bash
npm run pack
```

这个命令会先执行构建，再调用 `electron-builder --dir`。当前配置里，打包输出目录是 `release`，并且启用了 `asar`。仓库目前没有直接配置 dmg，而是先生成目录形式的应用产物 。

如果你只想打 mac 目录包，也可以运行：

```bash
npm run pack:mac
```

它对应的是：

```bash
npm run build && electron-builder --mac dir
```

### 推荐开发顺序

第一次上手，建议按这个顺序：

```bash
npm install
npm run dev
```

准备提交前：

```bash
npm run typecheck
npm run build
```

需要验证构建后的应用时：

```bash
npm run start
```

需要打包目录产物时：

```bash
npm run pack
```

## 附录

### 主要的涉及代码的人工干预

1. 基本技术选型，制定了React + Electron.js + TailwindCSS；
2. AI两次重构后，代码都一坨后（App.tsx几万行代码，开发模式下main进程有改动、不会自行刷新），要求参考Electron Vite的框架、Feature-Sliced Design重构；
3. 要求参考remodex跟pi-mono实现codex调用；
4. 手工去除了部分冗余文字元素、多余按钮（5次以内）；
5. 新用户引导也想改的，目前不过没啥精力去调。

---

来冒泡吧🫧
