<p align="center"><img src="assets/logo.svg" width="160" alt="Clip Goat" /></p>

<h1 align="center">Clip Goat</h1>

<p align="center"><a id="en"></a>English | <a href="#zh">简体中文</a></p>

Clip Goat is a lightweight, hassle-free tool for pulling highlights out of videos and organising your footage. It is powered by ffmpeg, built with Electron and React, and ships with a command-line interface.

## Why Clip Goat

Cutting a dozen seconds out of a recording is a small job, but the usual ways of doing it are heavier than the job itself:

- **Professional editors** such as Premiere Pro or DaVinci Resolve are built for full productions. To cut one clip you create a project, import the footage, place it on a timeline and choose export settings, and the export normally re-encodes the video.
- **The ffmpeg command line** is fast and lossless, but you have to find the timestamps yourself, write the arguments by hand, and you cannot see the picture while doing it.
- **Neither helps with the files afterwards.** Originals and clips end up mixed in the same folders, and it is hard to tell which recordings have already been dealt with.

Clip Goat does only this one job:

- There are no projects, tracks or export dialogs. You open a video, drag two handles and press Enter.
- It copies the streams instead of re-encoding whenever it can, so a short clip exports in about a second and loses no quality.
- The clip is named automatically and saved next to the original.
- The library shows originals and clips in one folder tree and marks the originals that already have a clip.

It is not a replacement for a video editor. It has no transitions, titles, colour tools or multi-track timeline.

## Use cases

Clip Goat suits any situation where the video is long and the part you need is short: game replays, screen recordings, stream archives, security footage, and footage shot on a phone.

Game replays are a typical example. Features such as NVIDIA Instant Replay save the last fixed stretch of gameplay each time. A 2-minute 4K60 recording is about 700 MB, and the part worth keeping is usually only a dozen seconds or so. As recordings pile up, they become hard to find and take up a lot of disk space.

<p align="center">
  <img src="docs/screenshot-20261122-222127.webp" width="860" alt="Cutting a clip out of a 2-minute game replay in Clip Goat" />
</p>

Clip Goat is designed around this workflow:

- On launch, it lists every video in your Videos folder and its subfolders.
- It cuts a few seconds out of a video. When the start sits on a keyframe, nothing is re-encoded and the quality is identical to the original.
- After each export it offers to move the original to the Recycle Bin, and originals that already have clips are marked in the library, so disk space is easy to reclaim.
- Clips can be exported to a folder you choose, or dragged between folders in the tree.

## Features

- **Library**: browses all videos as a folder tree, tells originals from exported clips, marks originals that already have a clip, and supports search, move, rename and delete.
- **Clipping**: drag the start and end handles on the timeline and export the part between them.
- **Stream copy first**: when the start sits on a keyframe, the audio and video streams are copied without re-encoding, so the quality is identical to the original. Exporting 8 seconds of a 4K60 recording takes about 1 second.
- **Frame-exact cuts**: when the start is not on a keyframe, the range is re-encoded automatically, exact to the frame, at a bitrate no higher than the original.
- **Joining ranges**: several ranges can be selected in one video and are merged in time order into a single file.
- **All audio tracks kept**: the exported file contains every audio track of the source.
- **Formats**: MP4, MKV, MOV and WebM preview directly. For formats such as AVI and FLV, a preview file is generated first; the export still reads the original file.
- **Bundled ffmpeg**: no separate installation is needed.
- **Command line**: the `clip-goat` command uses the same cutting logic as the desktop app.
- **Interface**: dark and light themes, English and Chinese.

## Usage

1. Open a video: drop a file onto the window, or click one in the library on the left.
2. Select a range: drag the handles at either end of the timeline. The preview jumps to the position of the handle.
3. Export: press Enter. A dialog shows the file name, filled in with the default; edit it if you like and press Enter again. The `.mp4` extension is fixed.
4. Optionally delete the original: once the clip is saved, the export bar asks whether to delete the original video. "Delete original" moves it to the Recycle Bin; "Keep original" leaves it in place.

By default the exported file is saved in the same folder as the source video and named `{original-name}_clip_{start}s-{end}s.mp4`, for example `Game_clip_112.5s-115.8s.mp4`. If a file with that name exists, a number is appended; nothing is overwritten.

Two chips sit to the left of the Export button:

- **Destination**: shows the target folder. Click it to change the folder.
- **Export mode**: shows "Instant" (stream copy) or "Exact" (re-encode). Clicking it while it shows "Exact" moves the start back to the previous keyframe and switches to stream copy.

When the pointer is over the preview, play, back and forward buttons appear in the middle of the picture. Back and forward jump 10 seconds by default; right-click either button to change this to 5, 15, 30 or 60 seconds. Inside a selected range a jump stops at the edge of the range; pressing again from the edge leaves the range. Volume and playback speed (0.25× to 2×) appear in the bottom-left corner of the picture; both apply to the preview only and do not affect exported files.

While you drag the start handle, it snaps to nearby keyframes. Hold `Alt` to turn snapping off.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play or pause. When playback starts inside the selection, only the selection plays |
| `I` / `O` | Set the start / end to the current position |
| `M` | Mute or unmute |
| `↑` / `↓` | Raise / lower the volume |
| `J` / `L` | Jump back / ahead by the skip amount (10 seconds by default) without stopping playback |
| `←` / `→` | Move one frame; hold `Shift` to move 1 second |
| `S` | Split the range at the current position; outside a range, add a new one |
| `Delete` | Remove the selected range |
| `Enter` | Export |
| `Esc` | Cancel the export |
| `Ctrl+O` | Open a video |
| Mouse wheel | Zoom the timeline; hold `Shift` to pan |

## Command line

```powershell
clip-goat -i Game.mp4 -s 112.5 -e 115.8
```

On success the command prints the path of the exported file to standard output and exits with code 0. On failure it prints the reason to standard error and exits with a non-zero code.

| Option | Description |
|---|---|
| `-i, --input` | Input video |
| `-s, --start` | Start in seconds; decimals allowed |
| `-e, --end` | End in seconds; decimals allowed |
| `--segments` | Several ranges joined in order, written as `start-end,start-end` |
| `-o, --output` | Output path; `.mp4`, `.mov` and `.mkv` are supported |
| `--out-dir` | Output folder; the file name is generated automatically |
| `--fast` | Stream copy from the nearest keyframe before the start |
| `--force-encode` | Always re-encode |
| `--overwrite` | Overwrite an existing output file |
| `--json` | Print the result as JSON |

Without `--fast` or `--force-encode`, the behaviour matches the desktop app: stream copy when the start sits on a keyframe, re-encode otherwise. If stream copy fails, it falls back to re-encoding.

Examples:

```powershell
clip-goat -i Game.mp4 --segments 10-15,42.5-48
clip-goat -i Game.mp4 -s 112.5 -e 115.8 --out-dir D:\clips --json
```

## Installation

No installer has been released yet, so the app has to be built from source. Building requires Node.js 20 or later.

```powershell
git clone <repository-url>
cd clip-goat
npm install
npm run dist
```

The installer is written to the `release` folder as `Clip Goat Setup x.y.z.exe`. It is not code-signed, so Windows shows a SmartScreen prompt the first time it runs.

To use only the command line, run `npm link` after `npm install`. The `clip-goat` command is then available in any directory.

On networks in mainland China, the dependencies need mirrors; see the [Chinese installation notes](#zh-install).

## Known limitations

- Stream copy can only start on a keyframe, so the start precision of an "Instant" export depends on the keyframe interval of the video.
- Re-encoding produces 8-bit H.264. HDR videos look washed out after re-encoding and should be exported with stream copy.
- The preview and the exported result may differ by one frame, more noticeably with variable-frame-rate videos.
- When ranges are joined, each seam gains about 20 to 100 ms of extra picture. Audio and video stay in sync.

## Development

```powershell
npm run dev      # development mode with hot reload; F12 opens the developer tools
npm start        # build the interface, then launch
npm test         # run the unit tests
```

| Directory | Contents |
|---|---|
| `shared/` | Cutting, video probing and file naming, shared by the desktop app and the command line |
| `cli/` | Command-line entry point |
| `electron/` | Main process: window, local video access, library, export jobs |
| `renderer/` | Interface, React + Vite |
| `assets/` | Icons and logo |

The environment variables `CLIP_GOAT_FFMPEG` and `CLIP_GOAT_FFPROBE` select a different ffmpeg and ffprobe.

## License

Released under GPL-3.0-or-later. The bundled ffmpeg is a GPL build.

---

<h1 align="center"><a id="zh"></a>Clip Goat 中文说明</h1>

<p align="center"><a href="#en">English</a> | 简体中文</p>

Clip Goat 是一个轻量省心的视频高光摘取与素材整理工具，基于 ffmpeg、使用 Electron 和 React 构建，同时提供命令行。

## 为什么做 Clip Goat

从一段录像里截取十几秒是一件很小的事，但常见的做法都比这件事本身重：

- **专业剪辑软件**（如 Premiere Pro、DaVinci Resolve）是为完整的制作流程设计的。截取一个片段需要新建工程、导入素材、放上时间线、设置导出参数，导出时通常会重新编码。
- **ffmpeg 命令行**速度快、不损画质，但需要自己找时间点、手写参数，操作时看不到画面。
- **两者都不管截完之后的文件。** 原片和片段混在同一批文件夹里，很难分辨哪些录像已经处理过。

Clip Goat 只做这一件事：

- 没有工程、轨道和导出对话框。打开视频，拖动两个手柄，按回车。
- 能复制音视频流时就不重新编码，短片段的导出约 1 秒完成，画质没有损失。
- 片段自动命名，保存在原片旁边。
- 资源库在一棵文件夹树里显示原片和片段，并标记已经截取过的原片。

它不能替代剪辑软件：没有转场、字幕、调色和多轨时间线。

## 适用场景

Clip Goat 适用于"视频很长、需要的部分很短"的情况，例如游戏回放、屏幕录制、直播存档、监控录像和手机拍摄的素材。

以游戏回放为例：NVIDIA 即时重放这类功能每次保存最近一段固定时长的录像，一段 2 分钟的 4K60 录像约 700 MB，其中值得保留的部分通常只有十几秒。录像数量增长后难以查找，也占用大量磁盘空间。

Clip Goat 针对这个过程设计：

- 启动后直接显示"视频"文件夹及其子文件夹中的全部视频。
- 截取一段视频中的几秒。起点位于关键帧时不重新编码，画质与原片一致。
- 每次导出后会询问是否把原片移到回收站；资源库里也会标出已经剪出过片段的原片，便于释放磁盘空间。
- 截出的片段可以导出到指定文件夹，或在文件夹树中拖动归类。

## 功能

- **资源库**：以文件夹树浏览全部视频，区分原片与截出的片段，标记已经截取过的原片，支持搜索、移动、重命名和删除。
- **截取片段**：在时间轨上拖动起点和终点手柄，导出两者之间的部分。
- **流复制优先**：起点位于关键帧时直接复制音视频流，不重新编码，画质与原片一致。一段 8 秒的 4K60 录像导出耗时约 1 秒。
- **精确截取**：起点不在关键帧时，自动重新编码该片段，精确到帧，码率不超过原片。
- **多段拼接**：一个视频可以选取多个片段，导出时按时间顺序合并为一个文件。
- **保留全部音轨**：导出文件包含原视频的所有音轨。
- **格式支持**：MP4、MKV、MOV、WebM 可直接预览；AVI、FLV 等格式会先生成预览文件，导出时仍读取原文件。
- **内置 ffmpeg**：不需要另外安装。
- **命令行**：提供 `clip-goat` 命令，与桌面应用使用同一套裁切逻辑。
- **界面**：深色和浅色主题，中文和英文。

## 使用

1. 打开视频：将文件拖入窗口，或在左侧资源库中点击。
2. 选取片段：拖动时间轨两端的手柄，预览画面会跳转到手柄所在的位置。
3. 导出：按回车。弹出的对话框里是默认文件名，可以修改，再按回车确认。扩展名固定为 `.mp4`，不能更改。
4. 可选，删除原片：片段保存后，导出栏会询问是否删除原视频。"删除原视频"把它移到回收站，"保留原视频"则不做改动。

导出的文件默认保存在原视频所在的文件夹，命名格式为 `{原文件名}_clip_{起点}s-{终点}s.mp4`，例如 `Game_clip_112.5s-115.8s.mp4`。存在同名文件时会追加序号，不会覆盖。

导出按钮左侧有两个标记：

- **导出位置**：显示目标文件夹，点击可以更改。
- **导出方式**：显示"秒出"（流复制）或"精确"（重新编码）。处于"精确"时点击该标记，会把起点移到前一个关键帧，改为流复制。

鼠标移到预览画面上时，画面中央显示播放、后退和前进按钮。后退和前进的跨度默认为 10 秒，右键这两个按钮可以改为 5、15、30 或 60 秒。在选区内跳转时，最多跳到选区的边缘；在边缘再按一次才会跳出选区。画面左下角同时显示音量和播放速度（0.25× 到 2×），这两项只作用于预览，不影响导出的文件。

拖动起点手柄时，手柄会吸附到附近的关键帧。按住 `Alt` 可以关闭吸附。

### 快捷键

| 按键 | 作用 |
|---|---|
| `空格` | 播放或暂停。从选区内开始播放时只播放选区 |
| `I` / `O` | 将起点 / 终点设为当前位置 |
| `M` | 静音或取消静音 |
| `↑` / `↓` | 调高 / 调低音量 |
| `J` / `L` | 后退 / 前进一个跨度（默认 10 秒），不中断播放 |
| `←` / `→` | 移动一帧，按住 `Shift` 移动 1 秒 |
| `S` | 在当前位置切开片段；当前位置不在选区内时新增一个片段 |
| `Delete` | 删除选中的片段 |
| `回车` | 导出 |
| `Esc` | 取消导出 |
| `Ctrl+O` | 打开视频 |
| 滚轮 | 缩放时间轨，按住 `Shift` 平移 |

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

<a id="zh-install"></a>

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
