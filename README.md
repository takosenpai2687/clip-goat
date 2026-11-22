<p align="center"><img src="assets/logo.svg" width="160" alt="Clip Goat" /></p>

<h1 align="center">Clip Goat</h1>

Clip Goat 是一个极简、支持命令行的视频截取工具。它从视频中截取指定的时间段并导出为新文件，基于 ffmpeg，使用 Electron 和 React 构建。

<p align="center">
  <img src="docs/screenshot-dark.webp" width="860" alt="Clip Goat 主界面" />
</p>

## 功能

- **截取片段**：在时间轨上拖动起点和终点手柄，导出两者之间的部分。
- **流复制优先**：起点位于关键帧时直接复制音视频流，不重新编码，画质与原片一致。一段 8 秒的 4K60 录像导出耗时约 1 秒。
- **精确截取**：起点不在关键帧时，自动重新编码该片段，精确到帧，码率不超过原片。
- **多段拼接**：一个视频可以选取多个片段，导出时按时间顺序合并为一个文件。
- **保留全部音轨**：导出文件包含原视频的所有音轨。
- **资源库**：以文件夹树浏览视频，区分原片与导出的片段，支持搜索、移动、重命名和删除。
- **格式支持**：MP4、MKV、MOV、WebM 可直接预览；AVI、FLV 等格式会先生成预览文件，导出时仍读取原文件。
- **内置 ffmpeg**：不需要另外安装。
- **命令行**：提供 `clip-goat` 命令，与桌面应用使用同一套裁切逻辑。
- **界面**：深色和浅色主题，中文和英文。

## 使用

1. 打开视频：将文件拖入窗口，或在左侧资源库中点击。
2. 选取片段：拖动时间轨两端的手柄，预览画面会跳转到手柄所在的位置。
3. 导出：按回车。

导出的文件默认保存在原视频所在的文件夹，命名格式为 `{原文件名}_clip_{起点}s-{终点}s.mp4`，例如 `Game_clip_112.5s-115.8s.mp4`。存在同名文件时会追加序号，不会覆盖。

导出按钮左侧有两个标记：

- **导出位置**：显示目标文件夹，点击可以更改。
- **导出方式**：显示"秒出"（流复制）或"精确"（重新编码）。处于"精确"时点击该标记，会把起点移到前一个关键帧，改为流复制。

拖动起点手柄时，手柄会吸附到附近的关键帧。按住 `Alt` 可以关闭吸附。

### 快捷键

| 按键 | 作用 |
|---|---|
| `空格` | 播放或暂停。从选区内开始播放时只播放选区 |
| `I` / `O` | 将起点 / 终点设为当前位置 |
| `←` / `→` | 移动一帧，按住 `Shift` 移动 1 秒 |
| `S` | 在当前位置切开片段；当前位置不在选区内时新增一个片段 |
| `Delete` | 删除选中的片段 |
| `回车` | 导出 |
| `Esc` | 取消导出 |
| `Ctrl+O` | 打开视频 |
| 滚轮 | 缩放时间轨，按住 `Shift` 平移 |

## 资源库

<p align="center">
  <img src="docs/screenshot-light.webp" width="860" alt="浅色主题" />
</p>

资源库是窗口左侧的文件夹树。首次启动时包含系统的"视频"文件夹及其子文件夹，可以添加其他文件夹。只显示含有视频的文件夹。

- **原片与片段**：文件名包含 `_clip_` 的视频视为导出的片段，显示剪刀图标。已经导出过片段的原片显示对勾。
- **筛选**：可以只显示原片或只显示片段，也可以按文件名搜索。
- **文件名显示**：文件名以所在文件夹的名称开头时，省略这部分。完整的文件名、大小和修改时间显示在悬停提示中。
- **移动**：将视频拖到目标文件夹上。
- **右键视频**：重命名、在文件夹中显示、移到回收站。
- **右键文件夹**：设为导出位置、在文件夹中显示。顶层文件夹还可以从资源库移除，移除不会删除文件。

原片与片段的区分只依据文件名，不使用数据库或隐藏文件。

## 命令行

```powershell
clip-goat -i Game.mp4 -s 112.5 -e 115.8
```

命令执行成功时，在标准输出打印导出文件的路径，退出码为 0。失败时在标准错误输出打印原因，退出码非 0。

| 参数 | 说明 |
|---|---|
| `-i, --input` | 输入视频 |
| `-s, --start` | 起点，单位为秒，支持小数 |
| `-e, --end` | 终点，单位为秒，支持小数 |
| `--segments` | 多个片段，按顺序拼接，格式为 `起-止,起-止` |
| `-o, --output` | 输出路径，支持 `.mp4`、`.mov`、`.mkv` |
| `--out-dir` | 输出文件夹，文件名自动生成 |
| `--fast` | 从起点之前最近的关键帧开始流复制 |
| `--force-encode` | 强制重新编码 |
| `--overwrite` | 覆盖已存在的输出文件 |
| `--json` | 以 JSON 格式输出结果 |

不指定 `--fast` 或 `--force-encode` 时，行为与桌面应用相同：起点位于关键帧则流复制，否则重新编码。流复制失败时自动改为重新编码。

示例：

```powershell
clip-goat -i Game.mp4 --segments 10-15,42.5-48
clip-goat -i Game.mp4 -s 112.5 -e 115.8 --out-dir D:\clips --json
```

## 安装

本项目尚未发布安装包，需要从源码构建。构建环境要求 Node.js 20 或以上。

```powershell
git clone <仓库地址>
cd clip-goat
npm install
npm run dist
```

安装包生成在 `release` 文件夹中，文件名为 `Clip Goat Setup x.y.z.exe`。安装包没有代码签名，首次运行时 Windows 会显示 SmartScreen 提示。

只使用命令行时，执行 `npm install` 后运行 `npm link`，即可在任意目录使用 `clip-goat` 命令。

中国大陆的网络环境下，安装依赖前需要设置镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:FFMPEG_BINARIES_URL="https://cdn.npmmirror.com/binaries/ffmpeg-static"
npm install --registry=https://registry.npmmirror.com
```

## 已知限制

- 流复制只能从关键帧开始，因此"秒出"的起点精度取决于视频的关键帧间隔。
- 重新编码输出 8 位色的 H.264。HDR 视频重新编码后颜色会变淡，这类视频应使用流复制。
- 预览画面与导出结果可能相差一帧，可变帧率的视频更明显。
- 多段拼接时，每个接缝处会多出约 20 到 100 毫秒的画面，音画保持同步。

## 开发

```powershell
npm run dev      # 开发模式，界面热更新，F12 打开开发者工具
npm start        # 构建界面后启动
npm test         # 运行单元测试
```

| 目录 | 内容 |
|---|---|
| `shared/` | 裁切、视频信息读取、文件命名，桌面应用和命令行共用 |
| `cli/` | 命令行入口 |
| `electron/` | 主进程：窗口、本地视频读取、资源库、导出任务 |
| `renderer/` | 界面，React + Vite |
| `assets/` | 图标和标志 |

环境变量 `CLIP_GOAT_FFMPEG` 和 `CLIP_GOAT_FFPROBE` 可以指定使用其他的 ffmpeg 和 ffprobe。

## 许可

本项目以 GPL-3.0-or-later 许可发布。内置的 ffmpeg 为 GPL 构建。
