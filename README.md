<p align="center"><img src="assets/logo.svg" width="160" alt="Clip Goat：一只嚼着胶片的山羊" /></p>

<h1 align="center">Clip Goat</h1>

给视频定一个起点和一个终点，几秒钟导出片段。它是"视频版截图工具"，不是剪辑软件。

- **桌面应用**（Electron）：拖入视频 → 拖两个手柄 → 回车导出。
- **命令行**（纯 Node.js）：供脚本和 agent 调用。
- 两者共用 `shared/` 里的同一套 ffmpeg 逻辑。

## 目录结构

```
clip-goat/
├─ electron/          Electron 主进程
│  ├─ main.js         窗口、本地视频协议、IPC、导出任务
│  ├─ library.js      资源库：扫描文件夹树、移动、重命名、监听变化
│  └─ preload.js      暴露给页面的白名单 API
├─ renderer/          页面（React + Vite）
│  ├─ index.html
│  └─ src/
│     ├─ App.jsx      状态、播放、快捷键、导出流程
│     ├─ components/  TitleBar / Library / Timeline / ExportBar / Menu / Backdrop
│     ├─ lib/         片段运算、胶片条缩略图、格式化、中英文案
│     └─ styles.css   深色与浅色主题
├─ shared/            GUI 和 CLI 共用的核心
│  ├─ clip.js         裁切：流复制优先，失败自动重编码，支持多片段拼接
│  ├─ probe.js        ffprobe：视频信息、关键帧列表
│  ├─ naming.js       isClippedFile、输出文件名、重名处理
│  ├─ proxy.js        为无法直接播放的格式生成预览
│  └─ binaries.js     ffmpeg / ffprobe 路径解析
├─ cli/index.js       命令行入口
├─ assets/            应用图标（icon.ico / icon.png）和 README 用的动画标志（logo.svg）
├─ scripts/dev.mjs    开发模式启动脚本
└─ test/              shared 的单元测试
```

## 本地启动

需要 Node.js 20 以上。

```powershell
npm install
npm run dev      # 开发模式，页面热更新，F12 打开开发者工具
npm start        # 构建页面后以生产方式启动
npm test         # shared 的单元测试
```

国内网络安装依赖时，Electron 和 ffmpeg 的二进制需要走镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:FFMPEG_BINARIES_URL="https://cdn.npmmirror.com/binaries/ffmpeg-static"
npm install --registry=https://registry.npmmirror.com
```

## 应用用法

1. 打开视频：拖进窗口、点资源库里的条目、`Ctrl+O`，或在系统里用 Clip Goat 打开。
2. 选片段：拖两个手柄，或边播边按 `I` / `O`。
3. 导出：按回车。文件默认保存在原视频旁边，命名为 `{原文件名}_clip_{起点}s-{终点}s.mp4`，重名时追加 `_2`、`_3`。导出按钮左边的文件夹标记可以改导出位置。

导出按钮旁的标记说明这次导出走哪条路：

- **秒出**：起点落在关键帧上，直接复制画面，不重新编码。拖动起点手柄靠近关键帧时会自动吸附（按住 `Alt` 可关闭吸附）。
- **精确**：起点不在关键帧上，重新编码这一段以保证逐帧精确，需要多等几秒。点一下这个标记可把起点对齐到关键帧，改为秒出。

| 快捷键 | 作用 |
|---|---|
| `空格` | 播放或暂停；在选区内开始播放时只播选区，并跳过片段之间的空隙 |
| `I` / `O` | 把选中片段的起点 / 终点设到播放头 |
| `←` / `→` | 逐帧移动，按住 `Shift` 每次 1 秒 |
| `S` | 在播放头处切开片段；播放头在选区外时新增一个片段 |
| `Delete` | 删除选中的片段 |
| `回车` | 导出；多个片段会按时间顺序拼接成一个文件 |
| `Esc` | 取消正在进行的导出 |
| 滚轮 | 缩放时间轨；`Shift` + 滚轮平移 |

### 资源库

左侧是一棵文件夹树，视频挂在所属文件夹下面，只显示含有视频的文件夹。首次启动时自动加入系统的"视频"文件夹，可以再添加别的文件夹。

- **区分原片和片段**：按文件名里的 `_clip_` 标记判断；片段带剪刀图标，已经剪过片段的原片带对勾。可切换"全部 / 原片 / 片段"，也可以按名字搜索。
- **名字去重**：文件名以所在文件夹的名字开头时，这段前缀不重复显示；过长的名字保留首尾。完整名字、大小和日期在悬停提示里。
- **移动**：把视频拖到树上的文件夹。
- **右键或点"⋯"**：重命名、在文件夹中显示、移到回收站（需要再点一次确认，可从回收站恢复）。
- **右键文件夹**：设为导出位置（带蓝点的就是当前导出位置）、从资源库移除（不删除文件）。

## 命令行用法

```powershell
node cli/index.js --input Game.mp4 --start 112.5 --end 115.8
# 输出：Game_clip_112.5s-115.8s.mp4 的完整路径

npm link         # 之后可在任意目录直接使用 clip-goat 命令
clip-goat -i Game.mp4 -s 112.5 -e 115.8 -o D:\clips\best.mp4
clip-goat -i Game.mp4 --segments 10-15,42.5-48 --json
```

| 参数 | 说明 |
|---|---|
| `-i, --input` | 输入视频 |
| `-s, --start` / `-e, --end` | 起止秒数，支持小数 |
| `--segments` | 多个片段按顺序拼接：`起-止,起-止` |
| `-o, --output` | 输出路径（`.mp4` / `.mov` / `.mkv`）；不填则在输入文件旁自动生成带 `_clip_` 的文件名 |
| `--out-dir` | 保留自动生成的文件名，但写到指定文件夹 |
| `--fast` | 从起点之前最近的关键帧开始流复制：秒出，但片段可能提前几秒开始 |
| `--force-encode` | 强制重编码，跳过流复制 |
| `--overwrite` | 输出文件已存在时覆盖 |
| `--json` | 以 JSON 输出结果（路径、实际方式、时长、大小） |

默认行为与应用一致：起点在关键帧上就流复制，否则精确重编码；流复制失败会自动降级为重编码。

成功时 stdout 输出文件路径，退出码 0。失败时错误信息写到 stderr：退出码 2 表示参数或输入有误，1 表示导出失败。

## 打包

```powershell
npm run dist     # 生成 release\Clip Goat Setup x.y.z.exe
```

国内网络首次打包需要下载 NSIS 等工具，先设置镜像：

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

安装包没有代码签名，在别人的电脑上首次运行会出现 SmartScreen 提示。应用图标来自 `assets/icon.ico`。

## ffmpeg 注意事项

- **内置，无需安装**：`ffmpeg-static`（ffmpeg 6.1.1）和 `ffprobe-static`（ffprobe 4.0.2）随应用打包，并通过 `asarUnpack` 解包到 `app.asar.unpacked`，否则安装后无法执行。
- **路径解析顺序**：环境变量 `CLIP_GOAT_FFMPEG` / `CLIP_GOAT_FFPROBE` → 内置二进制 → 系统 PATH。
- **流复制只能从关键帧开始**：这是"秒出"和"精确"两条路径存在的原因。
- **保留全部音轨**：导出时映射所有音频流，例如游戏声音和麦克风两条轨都会保留。
- **音画同步**：用"每秒一帧白闪加一声蜂鸣"的测试视频量过，秒出、精确、多片段拼接三条路径导出后，声音和画面的偏差都在 1 毫秒以内。多片段拼接时，每个接缝处会多出约 20–100 毫秒的画面停顿。
- **重编码参数**：H.264（libx264，CRF 18，veryfast）加 AAC 192k，保持原分辨率和帧率，码率不超过原片。HDR 视频重编码后会变成 8 位色，颜色可能偏灰；这种情况请用秒出。
- **预览与导出分离**：浏览器内核播不了的格式（AVI、FLV 等）会先在后台转一份 720p 预览，导出始终读取原文件。
- **预览与导出可能差一帧**：`<video>` 的定位不保证逐帧精确，可变帧率视频更明显。
- **许可**：内置的 ffmpeg 是 GPL 构建，公开分发本应用需遵守 GPL。

## 依赖

运行时（随安装包分发）：

| 包 | 版本 | 用途 |
|---|---|---|
| ffmpeg-static | 5.3.0 | ffmpeg 二进制 |
| ffprobe-static | 3.1.0 | ffprobe 二进制 |

开发时（页面依赖由 Vite 打进产物，不进安装包的 node_modules）：

| 包 | 版本 | 用途 |
|---|---|---|
| electron | 45.4.1 | 桌面运行时 |
| electron-builder | 26.18.0 | 打包 |
| vite | 8.3.8 | 页面构建 |
| @vitejs/plugin-react | 6.3.0 | React 支持 |
| react / react-dom | 19.3.1 | 界面 |
| motion | 14.14.0 | 动效 |
| lucide-react | 1.77.0 | 图标 |
| @fontsource-variable/inter | 5.3.0 | 内置字体 |
