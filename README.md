# DSH Right

给 DeepSeek Harness Web 界面加一个 **Codex 风格的文件/链接右键菜单**。

> 在 DeepSeek Harness 44.7.0（Windows）上开发与测试；DSH 升级后若菜单不出现，先看文末「DSH 内部接口」。

### 0.2.3 更新

- 另存为的宿主拷贝超时从 5 秒放宽到 30 秒：复制大文件或网络盘上的文件不再被误判为“请求超时”。
- 新增 `pnpm-workspace.yaml`，放行 esbuild 的构建脚本；pnpm 12 下 `pnpm install` 不再以 `ERR_PNPM_IGNORED_BUILDS` 失败。
- 文档补齐 `host/editor.js`、`client/async.js`、`menu-styles.js` 与 `settings.section` 槽位。

### 0.2.2 更新

- **DSH Right 设置… / 功能诊断… 从右键菜单移除**，统一放进 **设置 → 右键管理**。
- 诊断结果直接在设置页内展示（宿主路由、防覆盖保存、编辑器定位、桌面程序、会话文件、目录选择器、侧栏浏览器），可重新检测。
- 右键菜单更短，只保留当前文件/链接真正能做的事。

### 0.2.1 更新

- 新增 **设置 → 右键管理** 页面：直接在 DSH 设置里开关右键功能、调整同组顺序、切换紧凑模式/路径分隔符/首选打开程序，改完立即生效，不需要编辑配置文件。
- 使用自绘的「鼠标 + 滑块」图标作为设置分区图标，替换设置外壳默认的齿轮。
- 设置保存在当前浏览器（`localStorage`），与菜单共用同一份配置。
- 修复「找不到文件」提示只显示“该文件”的问题；跨会话相对目录链接补齐 cwd；首选程序被卸载时动作与菜单标签保持一致。

### 0.2.0 更新

- 防覆盖另存为：目标重名时选择「自动改名 / 替换文件 / 取消」。并发自动改名也不会覆盖已有文件。
- 完整回退：未加载宿主或仍运行旧版宿主时使用浏览器保存/下载；用户取消后立即停止。
- 路径识别收紧，普通函数调用保留原生菜单；**Shift + 右键**可在文件和链接上强制使用原生菜单。
- 新右键、Esc、点击其他区域、切换会话和卸载插件都会取消旧的菜单解析；网络与 Remote 调用有超时。
- 右键菜单底部新增 **DSH Right 设置…**：菜单项开关、分组内排序、紧凑模式、复制路径分隔符、首选打开程序。设置保存在当前浏览器，可恢复默认。
- 新增 **功能诊断…**：检测宿主版本、防覆盖保存、桌面应用、会话文件接口、目录选择器和侧栏浏览器，并可重新检测。
- 识别 `src/app.ts:42:8`、`src/app.ts#L42C8`，支持复制路径和行号；探测到 VS Code / Insiders 时，通过宿主的系统协议处理器定位到行。编辑器在宿主电脑启动，无需浏览器放行外部协议。
- 文件名搜索出现多个匹配时，展示完整相对路径供选择；UNC 链接保留服务器名。
- UTF-8 截断保留完整字符；文本复制各回退分支限制为 1 MiB，浏览器下载限制为 64 MiB。
- 下载响应统一作为附件，附带 `nosniff` 和 CSP 沙箱，避免 HTML/SVG 作为宿主页面执行。

升级后请**重启一次 DSH 并刷新页面**。只更新客户端时会避免调用旧宿主的覆盖式保存接口。

在聊天里的文件路径、文件提及、右侧「文件」树的一行、任意超链接上点右键：

- 打开文件（DSH 内预览）
- 在 VS Code 中打开 / **打开方式 ▸**（宿主探测到的关联程序，带应用图标）
- 在资源管理器中打开（macOS 为 Finder，Linux 为文件管理器）
- 另存为…
- 复制路径 / 相对路径 / 文件名 / 文件内容
- 链接：在侧边栏浏览器 / 外部浏览器打开，复制地址 / 文字 / Markdown 链接

菜单顺序参考 Codex 的文件引用菜单：打开 → 在应用里打开 → 打开方式 → 分隔线 → 另存为 → 复制 → 在资源管理器中显示。文件链接先显示文件动作，链接动作放在下面。

非文件、非链接的位置右键仍然是浏览器原生菜单（选文字、复制代码、消息操作都不受影响）。

> 本插件是独立实现，设计参考了 [AL1ghtm3ter/dsh-right-click-menu](https://github.com/AL1ghtm3ter/dsh-right-click-menu)（MIT），菜单结构和文案也对照了本机 Codex（OpenAI.Codex 26.1016）的文件引用菜单。没有直接复用它们的安装包，源码按本仓库的结构重写，方便后续改。

---

## 安装

### 方式一：Web 界面（推荐）

1. 左侧栏 **Plugins → Add plugin**。
2. 粘贴本目录的绝对路径（换成你机器上的实际位置）：
   ```
   C:\path\to\DSH Right
   ```
3. 点 **Install**。
4. 按界面提示刷新页面；**宿主半边**（复制文件内容、另存为所走的 `/dsh-right` 路由）需要**重启一次 DSH** 才会加载。只刷新页面时，文件树/链接菜单还能用，但「复制文件内容」会回退到 Session Remote，「另存为」可能只剩浏览器下载。

### 方式二：命令行（先完全退出 DSH）

```powershell
dsh plugin --profile desktop add "link:C:/path/to/DSH Right"
```

`desktop` 是当前桌面端 profile 名；如果用的是别的 profile，换成对应名字。装完启动 DSH。

### 开发时

```powershell
pnpm install
pnpm build     # 生成 lib/index.js 与 lib/client.js
pnpm test      # 路径、宿主路由、右键识别的单元测试
pnpm test:browser # 用已安装的 Edge 无界面验证新增对话框
```

`lib/` 是构建产物，不要手改；改 `src/` 后重新 `pnpm build`，刷新页面即可加载新的客户端 bundle。宿主半边改动要重启 DSH。

`pnpm-workspace.yaml` 里的 `allowBuilds: esbuild` 是 pnpm 12 的构建脚本白名单：esbuild 的 postinstall 负责安装平台二进制，缺了它 `pnpm install` 会以 `ERR_PNPM_IGNORED_BUILDS` 失败。旧版 pnpm 不读这个文件，保留它没有副作用。

---

## 使用

| 右键位置 | 识别方式 |
|---|---|
| 右侧栏「文件」树的一行 | 行上的 `data-files-path` / `data-files-entry` |
| 聊天里的文件链接 | 锚点 `href`（`dsh-resource://file/…`、`file://`、`api/file?path=…`） |
| 聊天里的文件提及按钮 | 按钮的 `title` 属性 |
| 正文 / 行内代码里的路径 | 指针下的 token，先问宿主确认文件存在 |
| 任意超链接 | 锚点 `href` |

路径支持：

- 工作区相对路径：`src/index.ts`
- 绝对路径：`C:\projects\app\main.py`、`/home/me/a.md`
- 只有文件名：`production.json`，走输入框同一套 `@file` 搜索，子目录里的也能找到
- 带空格、加了引号的路径：`"C:\My Projects\a b.txt"`

找不到时会在底部提示「工作区里没有找到 …」，不会静默吞掉右键。

### 菜单项

文件/文件夹：

| 菜单项 | 行为 |
|---|---|
| 打开文件 / 在文件树中展开 | 用 DSH 自带预览打开；文件夹则展开 |
| 在 VS Code 中打开 | `session.openWorkspacePath`；应用名用短名（VS Code / VS Code Insiders），设置里可换首选程序 |
| 打开方式 ▸ | 宿主报告的关联程序列表，带应用图标，当前默认项带「（默认）」 |
| 在编辑器中定位到第 N 行 | 路径带 `:42` / `#L42C8` 时出现；通过宿主打开 VS Code 到行列 |
| 在资源管理器中打开 | 在文件管理器中定位（macOS / Linux 文案不同） |
| 复制路径 / 相对路径 / 文件名 / 路径和行号 | 写剪贴板，分隔符可在设置里统一 |
| 复制文件内容 | 读文本进剪贴板（上限 1 MiB，二进制拒绝） |
| 另存为… | 浏览器保存对话框 → 目录选择器 + 宿主拷贝 → 浏览器下载；重名时选择改名/替换/取消 |

链接：

| 菜单项 | 行为 |
|---|---|
| 在侧边栏中打开 | 右侧栏 Browser tab（不可用时置灰） |
| 在外部浏览器中打开 | 系统默认浏览器 |
| 复制链接地址 / 链接文字 / Markdown 链接 | 写剪贴板 |

链接本身指向文件时，同一个菜单里会同时出现链接项和文件项。

### 设置 → 右键管理

DSH 的 **设置** 侧栏里新增 **右键管理** 分区，不需要再改配置文件：

- 勾选/取消每个右键功能（打开、打开方式、另存为、复制、定位、链接操作等）；
- 在同一分组内用 ↑/↓ 调整顺序；
- 紧凑菜单、复制路径分隔符、首选打开程序；
- 修改立即写入当前浏览器的 `localStorage`，下一次右键直接生效；
- **功能诊断**：页面内直接检查宿主路由、防覆盖保存、编辑器定位、桌面程序、会话文件接口、目录选择器和侧栏浏览器，可重新检测；
- 右键菜单里不再放「设置 / 功能诊断」入口，避免菜单越用越长。

“首选打开程序”的候选列表来自宿主最近一次文件关联查询，所以先在文件上打开一次右键菜单，这里才会列出应用。

设置外壳目前只按 section id 给固定图标，没有给插件分区留图标接口；插件用 `data-dsh-right-nav` 标记这一行，再用 CSS mask 把默认齿轮换成自绘的「鼠标 + 滑块」图标。

源图 [`assets/nav-icon.png`](assets/nav-icon.png) 是 64px 的透明底「鼠标 + 滑块」图；直接用它缩到 16px 会糊，所以 `scripts/build-nav-icon.mjs` 另存了一个 16px 光学校正版 SVG（同款图案、1.25px 描边，和 DSH 其他图标同粗细），CSS 使用它作为 mask，PNG 保留作源图。`pnpm icon` 会重新生成 `src/client/nav-icon.js`，`pnpm build` 会自动执行。以后 DSH 支持 `settings.section` 自定义图标时，可以删掉 `plugin.jsx` 里的标记 effect 和 `menu-styles.js` 里的 `data-dsh-right-nav` 规则。

---

## 代码结构

```
DSH Right/
├─ package.json          插件清单：dsh.bundle.patch / dsh.client.platform
├─ pnpm-workspace.yaml   pnpm 12 构建脚本白名单（esbuild 的 postinstall）
├─ cordis.patch.yml      宿主半边的 Loader 行
├─ icon.svg              插件卡片图标
├─ assets/nav-icon.png   设置分区图标（鼠标 + 滑块，透明背景）
├─ locale/{zh,en}.json   插件卡片的标题/描述（菜单文案在 bundle 里）
├─ src/
│  ├─ shared/
│  │  ├─ constants.js    插件 id、路由前缀、大小上限
│  │  └─ paths.js        两种路径拼写、相对化、dsh-resource 地址
│  ├─ host/
│  │  ├─ index.js        Cordis 函数插件入口
│  │  ├─ routes.js       /dsh-right 下的 HTTP 路由与信任围栏
│  │  ├─ fs-service.js   stat / read / copy（可单测）
│  │  └─ editor.js       VS Code 行号 URI / 系统协议启动
│  └─ client/
│     ├─ index.jsx       bundle 入口，导出 apply/inject
│     ├─ plugin.jsx      词典、overlay、contextmenu 监听
│     ├─ context.js      从 DOM 找 Session / cwd，侧栏 browser 是否可用
│     ├─ text.js         指针下的路径 token 扫描
│     ├─ resolver.js     路径 → 绝对路径/类型；链接地址解析
│     ├─ remotes.js      Remote 命名空间绑定
│     ├─ api.js          /dsh-right 路由调用
│     ├─ async.js        超时/取消封装、流式下载字节上限
│     ├─ actions.js      每个菜单项的行为
│     ├─ menu-model.js   纯函数：菜单行集合
│     ├─ menu.jsx        Menu / Toast 渲染
│     ├─ dialogs.jsx     菜单内设置 / 诊断 / 冲突 / 同名选择
│     ├─ settings.js     设置模型、分组、localStorage
│     ├─ settings-page.jsx 设置 → 右键管理 页面
│     ├─ nav-icon.js     由 assets/nav-icon.png 生成的 16px mask 与源图 data URL
│     ├─ menu-styles.js  菜单/设置页 CSS、分区图标 mask
│     ├─ store.js        菜单与 toast 的外部 store
│     └─ i18n.js         中英词典
├─ scripts/build.mjs     esbuild 打包两个半边
├─ scripts/build-nav-icon.mjs  图标 → data URL
└─ test/                 node:test 单测
```

### 构建方式

- **宿主半边**：`src/host/index.js` 用 esbuild 打成 ESM → `lib/index.js`。
- **浏览器半边**：`src/client/index.jsx` 打成 CJS，再由 `build.mjs` 包进 DSH 的
  `window.__ModuleLoader__.load({ id, factory })` 外壳 → `lib/client.js`。
  `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives` 作为
  external，由 DSH 的共享模块基座提供。
- 没有安装脚本、没有运行时构建；装到 profile 里直接加载 `lib/`。

### 加一个菜单项

1. `src/client/menu-model.js` 里加一行（id + 文案 key）。
2. `src/client/actions.js` 的 `run()` 里处理这个 id。
3. `src/client/i18n.js` 补中英文案。
4. 如果需要新的宿主能力，在 `src/host/routes.js` 加路由，并在 `src/client/api.js` 加调用。
5. `pnpm build && pnpm test`。

### DSH 内部接口

插件依赖下面这些 DSH 当前版本的接口；DSH 升级后如果菜单突然不出现，先对照这里：

- DOM：`[data-conversation-session]`、`[data-sidebar-right-session]`、
  `[data-files-state="tree"][data-files-root]`、`[data-files-path][data-files-entry]`
- 客户端服务：`ctx.slots`、`ctx.locale`、`ctx.get("sessions")`、
  `ctx.get("uiSession").adapter.current`、`ctx.get("sidebarRight")`、
  `ctx.get("sidebarRightTabs")`
- Remote：`session.openWorkspacePath/canOpenWorkspacePath/workspacePathApplications`、
  `workspaceFiles.stat/list/read/readBytes`、`fileReferences.list`、`directoryPicker.pick`
- 槽位：`shell.overlay`、`settings.section`
- CSS 变量：`--dsh-content-font-size`（DSH 的「会话内容字号」）

`src/client/context.js` 和 `src/client/resolver.js` 是这些假设最集中的地方。

---

## 外观

菜单不走 primitives 的 `compact` 模式（11px 字号 / 24px 行高），而是：

- 字号跟随 DSH 的「设置 → 通用 → 字号大小」（`--dsh-content-font-size`），
  当前取内容字号 -2px：DSH 14px 时菜单 12px；改设置立即生效；
- 行高 34px、左右内边距 10px、最小宽度 220px；
- 图标 15px，圆角使用非 compact 的 `radius-lg`；
- 「在 … 中打开」和「打开方式」使用宿主返回的应用图标；
- 应用名做短名映射（`Visual Studio Code` → `VS Code`），标签形如 `在VS Code中打开`；
- 显示位置按平台切换：Windows「在资源管理器中打开」、macOS「在 Finder 中显示」、
  Linux「在文件管理器中打开」。

样式在 [`src/client/menu-styles.js`](src/client/menu-styles.js)，通过 `Menu` 的
`listClassName` 只作用在本插件的 `[role="menu"]` 上，不污染 DSH 自己的菜单。

---

## 性能

- 菜单先出现，再补宿主事实：桌面能力成功缓存 60 秒，失败缓存 5 秒；
  关联程序查询在后台进行。
- Windows 上 `workspacePathApplications` 每次都会启动 `powershell.exe -STA`
  （实测空启动约 270–440ms）再查 Shell 关联，所以按扩展名缓存 60 秒。
  第一份 `.md` 菜单可能晚一拍出现「打开方式」，之后同扩展名不再查。
- 文件树行右键不需要网络往返；聊天链接/正文路径要先用一次
  `workspaceFiles.stat`（或 `/dsh-right/stat`）确认文件存在。
- 页面加载后的第一次右键会挂载 overlay 和词典；之后的菜单复用同一实例。

---

## 安全说明

- 宿主路由都先过 `connection.requestRejection`（Host/Origin 围栏 + 浏览器认证），
  再校验方法、`application/json`、64 KiB 请求体和绝对路径。
- 提供 6 条路由：`GET /ping`、`GET /raw`、`POST /stat`、`POST /read`、
  `POST /save-as`、`POST /open-location`。其中 `save-as` 会写入副本，默认拒绝覆盖；替换必须显式选择。
- `open-location` 仅允许 VS Code / Insiders 协议、已有文件和正整数行列；直接传参启动系统处理器，不拼接 shell 命令。返回成功表示已交给系统，无法确认编辑器最终是否打开。
- `raw` 单文件上限 64 MiB；`read` 只读 1 MiB 文本；二进制按 NUL 检测拒绝复制。
- 插件会读写你右键指向的路径。它和所有 DSH 插件一样以宿主用户权限运行；
  装第三方代码前仍应自己判断。

---

## 已知限制

- **只支持右键**。左键单击文件链接在 DSH 里仍然是直接打开右侧预览；本插件不改变左键行为。
- **宿主半边要重启**。新装/替换包后，`/dsh-right` 路由要等应用下次启动才加载；只刷新页面时相关功能会回退或不可用。
- **「打开方式」依赖宿主探测**。DSH 只列出它认识的桌面应用；VS Code 没装或没被探测到时不会出现。
- **文件树选择器是 DSH 内部结构**。DSH 改 DOM 属性时，文件树右键会失效；聊天链接/路径扫描通常不受影响。
- **设置按浏览器保存**。不会同步到其他设备；浏览器禁用存储时仅本次页面有效并提示。
- **另存为**：Chromium 的 `showSaveFilePicker` 不可用时走目录选择器 + 宿主拷贝；再不可用时退化为浏览器下载。

---

## License

MIT。菜单交互的设计参考了 `dsh-right-click-menu`（MIT, AL1ghtm3ter），
本仓库的代码与构建方式为独立实现。
