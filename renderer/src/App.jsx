import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Maximize2, Pause, Play, Plus, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import TitleBar from './components/TitleBar';
import Library from './components/Library';
import Backdrop from './components/Backdrop';
import StageControls, { RATE_CHOICES, SKIP_CHOICES } from './components/StageControls';
import Timeline from './components/Timeline';
import ExportBar from './components/ExportBar';
import { I18nContext, STRINGS, defaultLang, errorText } from './lib/i18n';
import { clamp, formatTime } from './lib/format';
import { addAt, makeSegment, moveEdge, snapStarts, totalLength } from './lib/segments';

const api = window.clipgoat;
const PLAYABLE_CODECS = ['h264', 'hevc', 'vp8', 'vp9', 'av1'];
const PLAYABLE_EXTS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];
const IDLE = { status: 'idle', percent: 0 };

const stored = (key, fallback) => localStorage.getItem(key) ?? fallback;
const storedJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const samePath = (a, b) => a.toLowerCase() === b.toLowerCase();
const isInside = (dir, root) => samePath(dir, root) || dir.toLowerCase().startsWith(root.toLowerCase().replace(/[\\/]+$/, '') + (root.includes('/') ? '/' : '\\'));
const allRoots = (roots, tempRoots) => [...(roots || []), ...tempRoots.filter((p) => !(roots || []).some((r) => samePath(r, p)))];
const extOf = (name) => name.split('.').pop().toLowerCase();

// How to feed the <video> tag: the file itself, a remuxed MP4, or a transcoded proxy.
function firstLevel(doc) {
  if (!PLAYABLE_CODECS.includes(doc.info.video.codec)) return 'transcode';
  return PLAYABLE_EXTS.includes(extOf(doc.name)) ? 'direct' : 'remux';
}

function nextLevel(doc, level) {
  if (level === 'direct') return ['mp4', 'm4v', 'mov'].includes(extOf(doc.name)) ? 'transcode' : 'remux';
  return level === 'remux' ? 'transcode' : null;
}

export default function App() {
  const [lang, setLang] = useState(() => stored('lang', defaultLang()));
  const [theme, setTheme] = useState(() => stored('theme', 'dark'));
  const [sidebarOpen, setSidebarOpen] = useState(() => stored('sidebar', '1') === '1');
  // roots is null until the first run has picked the system Videos folder.
  const [roots, setRoots] = useState(() => storedJson('roots', null));
  const [tempRoots, setTempRoots] = useState([]);
  const [trees, setTrees] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set(storedJson('expanded', [])));
  const [filter, setFilter] = useState('all');
  const [dest, setDest] = useState(() => stored('dest', '') || null);
  const [notice, setNotice] = useState('');

  const [doc, setDoc] = useState(null);
  const [load, setLoad] = useState({ status: 'idle' });
  const [src, setSrc] = useState(null);
  const [keyframes, setKeyframes] = useState(null);
  const [segments, setSegments] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [view, setView] = useState({ start: 0, end: 1 });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [plan, setPlan] = useState({ mode: 'encode', name: '' });
  const [exp, setExp] = useState(IDLE);
  const [dropping, setDropping] = useState(false);
  const [skip, setSkip] = useState(() => {
    const saved = Number(stored('skip', 10));
    return SKIP_CHOICES.includes(saved) ? saved : 10;
  });
  const [volume, setVolume] = useState(() => clamp(Number(stored('volume', 1)) || 0, 0, 1));
  const [muted, setMuted] = useState(() => stored('muted', '0') === '1');
  const [rate, setRate] = useState(() => {
    const saved = Number(stored('rate', 1));
    return RATE_CHOICES.includes(saved) ? saved : 1;
  });
  const [stageHot, setStageHot] = useState(false);
  const stageTimer = useRef(0);

  const t = STRINGS[lang];
  const videoRef = useRef(null);
  const pendingSeek = useRef(null);
  const previewing = useRef(false);
  const level = useRef('direct');
  const loadToken = useRef(0);
  const live = useRef({});
  const noticeTimer = useRef(0);
  live.current = { doc, skip, roots, tempRoots, dest, segments, activeId, view, time, load, exp, plan, t };

  const duration = doc ? doc.info.duration : 0;
  const fps = doc ? doc.info.video.fps || 30 : 30;
  const minLen = Math.max(0.05, 1 / fps);
  const locked = exp.status === 'running';

  /* ---------- library ---------- */

  const rescan = useCallback(async () => {
    const all = allRoots(live.current.roots, live.current.tempRoots);
    if (!all.length) {
      setTrees([]);
      return;
    }
    try {
      setTrees(await api.scan(all));
    } catch {}
  }, []);

  const flash = useCallback((message) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 4000);
  }, []);

  const toggleDir = useCallback((dir) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);

  // Makes sure a folder is part of the tree and every folder above it is open.
  const reveal = useCallback((dir) => {
    const { roots: saved, tempRoots: temp } = live.current;
    let root = allRoots(saved, temp).find((r) => isInside(dir, r));
    if (!root) {
      root = dir;
      setTempRoots((prev) => [...prev, dir]);
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      const parts = dir.slice(root.length).split(/[\\/]/).filter(Boolean);
      const sep = dir.includes('/') ? '/' : '\\';
      let at = root.replace(/[\\/]+$/, '');
      next.add(root);
      for (const part of parts) {
        at += sep + part;
        next.add(at);
      }
      return next;
    });
  }, []);

  const addRoot = useCallback(async () => {
    const dir = await api.openFolder();
    if (!dir) return;
    setRoots((prev) => ((prev || []).some((r) => samePath(r, dir)) ? prev : [...(prev || []), dir]));
    setExpanded((prev) => new Set(prev).add(dir));
  }, []);

  const removeRoot = useCallback((dir) => {
    setRoots((prev) => (prev || []).filter((r) => !samePath(r, dir)));
    setTempRoots((prev) => prev.filter((r) => !samePath(r, dir)));
  }, []);

  const chooseDest = useCallback(async () => {
    const dir = await api.openFolder();
    if (dir) setDest(dir);
  }, []);

  /* ---------- loading a video ---------- */

  const buildProxy = useCallback(async (target, lvl, token) => {
    level.current = lvl;
    setSrc(null);
    setLoad({ status: 'loading', percent: 0 });
    try {
      const url = await api.proxy(target.path, lvl, target.info.duration);
      if (token === loadToken.current) setSrc(url);
    } catch (err) {
      if (token !== loadToken.current || err.code === 'ABORTED') return;
      if (lvl === 'remux') buildProxy(target, 'transcode', token);
      else setLoad({ status: 'error', message: errorText(live.current.t, err, 'errPreview') });
    }
  }, []);

  const openFile = useCallback(
    async (filePath) => {
      if (live.current.exp.status === 'running') return;
      const token = ++loadToken.current;
      if (videoRef.current) videoRef.current.pause();
      api.cancelProxy();
      setExp(IDLE);
      setLoad({ status: 'loading' });
      try {
        const target = await api.probe(filePath);
        if (token !== loadToken.current) return;
        const seg = makeSegment(0, target.info.duration);
        setDoc(target);
        setKeyframes(null);
        setSegments([seg]);
        setActiveId(seg.id);
        setView({ start: 0, end: target.info.duration });
        setTime(0);
        setPlaying(false);
        pendingSeek.current = null;

        const lvl = firstLevel(target);
        if (lvl === 'direct') {
          level.current = lvl;
          setSrc(target.url);
        } else {
          buildProxy(target, lvl, token);
        }
        reveal(target.dir);
        api
          .keyframes(filePath, target.info.startTime)
          .then((times) => token === loadToken.current && setKeyframes(times))
          .catch(() => {});
      } catch (err) {
        if (token !== loadToken.current) return;
        setDoc(null);
        setSrc(null);
        setLoad({ status: 'error', message: errorText(live.current.t, err, 'errProbe') });
      }
    },
    [buildProxy, reveal],
  );

  const escalate = useCallback(() => {
    const target = live.current.doc;
    if (!target) return;
    const next = nextLevel(target, level.current);
    if (next) buildProxy(target, next, loadToken.current);
    else setLoad({ status: 'error', message: live.current.t.errPreview });
  }, [buildProxy]);

  const pickFile = useCallback(async () => {
    const filePath = await api.openFile();
    if (filePath) openFile(filePath);
  }, [openFile]);

  const closeDoc = useCallback(() => {
    loadToken.current++;
    if (videoRef.current) videoRef.current.pause();
    api.cancelProxy();
    setDoc(null);
    setSrc(null);
    setLoad({ status: 'idle' });
    setExp(IDLE);
  }, []);

  // Move, rename or trash a video. If it is the one on screen, let go of it first and reopen it afterwards.
  const fileOp = useCallback(
    async (filePath, run) => {
      if (live.current.exp.status === 'running') return;
      const current = live.current.doc;
      const wasOpen = Boolean(current && samePath(current.path, filePath));
      if (wasOpen) {
        closeDoc();
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      try {
        const next = await run();
        await rescan();
        if (wasOpen && next) openFile(next);
      } catch (err) {
        flash(errorText(live.current.t, err, 'errOp'));
        rescan();
        if (wasOpen) openFile(filePath);
      }
    },
    [closeDoc, rescan, openFile, flash],
  );

  const moveFile = useCallback((src, destDir) => fileOp(src, () => api.moveFile(src, destDir)), [fileOp]);
  const renameFile = useCallback((filePath, stem) => fileOp(filePath, () => api.renameFile(filePath, stem)), [fileOp]);
  const trashFile = useCallback(
    (filePath) =>
      fileOp(filePath, async () => {
        await api.trashFile(filePath);
        return null;
      }),
    [fileOp],
  );
  const showPath = useCallback((target) => api.showInFolder(target), []);

  /* ---------- playback ---------- */

  const seek = useCallback((target) => {
    const video = videoRef.current;
    setTime(target);
    if (!video) return;
    if (video.seeking) pendingSeek.current = target;
    else video.currentTime = target;
  }, []);

  const onSeeked = () => {
    if (pendingSeek.current === null) return;
    const target = pendingSeek.current;
    pendingSeek.current = null;
    videoRef.current.currentTime = target;
  };

  // Jump back or ahead without stopping playback. Inside a range the jump stops at the range's edge,
  // so reviewing a clip never flies out of it; a second press from the edge leaves the range.
  const skipBy = useCallback(
    (dir) => {
      const { doc: current, skip: amount, time: now, segments: segs } = live.current;
      if (!current) return;
      const base = pendingSeek.current ?? (videoRef.current ? videoRef.current.currentTime : now);
      const edge = 0.06;
      const seg = segs.find((s) => base >= s.start - edge && base <= s.end + edge);
      let target = base + dir * amount;
      if (seg && dir > 0 && base < seg.end - edge) target = Math.min(target, seg.end);
      else if (seg && dir < 0 && base > seg.start + edge) target = Math.max(target, seg.start);
      else previewing.current = false;
      seek(clamp(target, 0, Math.max(0, current.info.duration - 0.01)));
    },
    [seek],
  );

  // Stage controls show while the pointer moves over the picture and fade after it rests.
  const wakeStage = useCallback(() => {
    setStageHot(true);
    clearTimeout(stageTimer.current);
    stageTimer.current = setTimeout(() => setStageHot(false), 2200);
  }, []);
  const sleepStage = useCallback(() => {
    clearTimeout(stageTimer.current);
    setStageHot(false);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    const { segments: segs, load: state, doc: target } = live.current;
    if (!video || state.status !== 'ready' || !segs.length) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    const now = video.currentTime;
    const last = segs[segs.length - 1];
    if (segs.some((s) => now >= s.start && now < s.end - 0.05)) {
      previewing.current = true;
    } else if (Math.abs(now - last.end) < 0.06 || now >= target.info.duration - 0.05) {
      // At the end of the selection: replay it from the top.
      previewing.current = true;
      video.currentTime = segs[0].start;
      setTime(segs[0].start);
    } else {
      previewing.current = false;
    }
    video.play().catch(() => {});
  }, []);

  // While previewing, playback skips the gaps between ranges and stops after the last one.
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    const loop = () => {
      const video = videoRef.current;
      if (video) {
        let now = video.currentTime;
        if (previewing.current) {
          const segs = live.current.segments;
          if (!segs.some((s) => now >= s.start - 0.05 && now < s.end)) {
            const next = segs.find((s) => s.start > now);
            if (next) {
              now = next.start;
            } else {
              video.pause();
              now = segs[segs.length - 1].end;
            }
            video.currentTime = now;
          }
        }
        setTime(now);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  /* ---------- ranges ---------- */

  const applySegments = useCallback((next) => {
    live.current.segments = next;
    setSegments(next);
    setExp((prev) => (prev.status === 'running' ? prev : IDLE));
  }, []);

  const onEdge = useCallback(
    (id, edge, target) => {
      const { segments: segs, doc: current } = live.current;
      if (!current) return;
      const next = moveEdge(segs, id, edge, target, current.info.duration, minLen);
      const seg = next.find((s) => s.id === id);
      applySegments(next);
      if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
      // Half a frame inside the range, so the picture is the first (or last) frame the export will contain.
      const half = 0.5 / (current.info.video.fps || 30);
      const shown = edge === 'start' ? seg.start + half : seg.end - half;
      seek(clamp(shown, 0, Math.max(0, current.info.duration - 0.01)));
    },
    [applySegments, seek, minLen],
  );

  // I / O: put the active range's start or end at the playhead, restarting the range if the playhead is past it.
  const markEdge = useCallback(
    (edge) => {
      const { segments: segs, activeId: id, time: now, doc: current } = live.current;
      const i = segs.findIndex((s) => s.id === id);
      if (i < 0 || !current) return;
      const seg = segs[i];
      const lower = i > 0 ? segs[i - 1].end : 0;
      const upper = i < segs.length - 1 ? segs[i + 1].start : current.info.duration;
      const at = clamp(now, lower, upper);
      let next;
      if (edge === 'start') next = at >= seg.end - minLen ? { ...seg, start: at, end: upper } : { ...seg, start: at };
      else next = at <= seg.start + minLen ? { ...seg, start: lower, end: at } : { ...seg, end: at };
      if (next.end - next.start < minLen) return;
      applySegments(segs.map((s) => (s.id === id ? next : s)));
    },
    [applySegments, minLen],
  );

  const addRange = useCallback(() => {
    const { segments: segs, time: now, view: v, doc: current } = live.current;
    if (!current) return;
    const result = addAt(segs, now, current.info.duration, v.end - v.start, minLen);
    if (!result) return;
    applySegments(result.segments);
    setActiveId(result.activeId);
  }, [applySegments, minLen]);

  const removeRange = useCallback(() => {
    const { segments: segs, activeId: id } = live.current;
    if (segs.length < 2) return;
    const i = segs.findIndex((s) => s.id === id);
    const next = segs.filter((s) => s.id !== id);
    applySegments(next);
    setActiveId(next[Math.max(0, Math.min(i, next.length - 1))].id);
  }, [applySegments]);

  const snapToKeyframes = useCallback(() => {
    if (keyframes) applySegments(snapStarts(live.current.segments, keyframes));
  }, [keyframes, applySegments]);

  const zoom = useCallback(
    (factor) => {
      const { view: v, time: now } = live.current;
      const span = v.end - v.start;
      const nextSpan = clamp(span * factor, Math.min(duration, Math.max(1, 30 / fps)), duration);
      const anchor = now >= v.start && now <= v.end ? now : v.start + span / 2;
      const start = clamp(anchor - (anchor - v.start) * (nextSpan / span), 0, duration - nextSpan);
      setView({ start, end: start + nextSpan });
    },
    [duration, fps],
  );

  /* ---------- export ---------- */

  const runExport = useCallback(async () => {
    const { doc: current, segments: segs, exp: state, plan: currentPlan, t: text } = live.current;
    if (!current || state.status === 'running') return;
    if (videoRef.current) videoRef.current.pause();
    setExp({ status: 'running', percent: 0, mode: currentPlan.mode });
    try {
      const result = await api.exportClip({
        input: current.path,
        segments: segs.map(({ start, end }) => ({ start, end })),
        outputDir: live.current.dest,
      });
      setExp({ status: 'done', percent: 100, result });
      rescan();
    } catch (err) {
      if (err.code === 'ABORTED') setExp(IDLE);
      else setExp({ status: 'error', percent: 0, message: errorText(text, err, 'errExport') });
    }
  }, [rescan]);

  const showResult = useCallback(() => {
    const { exp: state } = live.current;
    if (state.result) api.showInFolder(state.result.output);
  }, []);

  const dismissResult = useCallback(() => setExp(IDLE), []);
  const cancelExport = useCallback(() => api.cancelExport(), []);

  // Ask the main process which path this export will take and what the file will be called.
  useEffect(() => {
    if (!doc || !segments.length) return undefined;
    const timer = setTimeout(() => {
      api
        .plan(doc.path, segments.map(({ start, end }) => ({ start, end })), doc.info.video.fps, dest)
        .then(setPlan)
        .catch(() => {});
    }, 90);
    return () => clearTimeout(timer);
  }, [doc, segments, keyframes, trees, dest]);

  /* ---------- wiring ---------- */

  useEffect(() => {
    const offProgress = api.on('export:progress', (p) =>
      setExp((prev) => (prev.status === 'running' ? { ...prev, percent: p.percent, mode: p.mode } : prev)),
    );
    const offProxy = api.on('media:proxy-progress', (p) =>
      setLoad((prev) => (prev.status === 'loading' ? { ...prev, percent: p.percent } : prev)),
    );
    const offChanged = api.on('library:changed', rescan);
    const offOpen = api.on('app:open-file', (filePath) => openFile(filePath));

    api.initialFile().then((filePath) => filePath && openFile(filePath));
    return () => {
      offProgress();
      offProxy();
      offChanged();
      offOpen();
    };
  }, [openFile, rescan]);

  // First run: start the library with the system Videos folder.
  useEffect(() => {
    if (roots !== null) return;
    api.defaultRoot().then((dir) => {
      setRoots([dir]);
      setExpanded((prev) => new Set(prev).add(dir));
    });
  }, [roots]);

  useEffect(() => {
    if (roots !== null) localStorage.setItem('roots', JSON.stringify(roots));
    rescan();
  }, [roots, tempRoots, rescan]);

  useEffect(() => localStorage.setItem('expanded', JSON.stringify([...expanded])), [expanded]);
  useEffect(() => localStorage.setItem('dest', dest || ''), [dest]);
  useEffect(() => localStorage.setItem('skip', String(skip)), [skip]);

  // Volume and speed belong to the preview only; exports are never affected.
  useEffect(() => {
    localStorage.setItem('volume', String(volume));
    localStorage.setItem('muted', muted ? '1' : '0');
    localStorage.setItem('rate', String(rate));
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    video.playbackRate = rate;
  }, [volume, muted, rate, src, load.status]);

  const changeVolume = useCallback((value) => {
    setVolume(clamp(value, 0, 1));
    setMuted(false);
  }, []);
  // Unmuting from zero volume would stay silent, so bring it back to an audible level.
  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
    setVolume((prev) => (prev === 0 ? 0.5 : prev));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    api.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    localStorage.setItem('lang', lang);
  }, [lang]);

  useEffect(() => localStorage.setItem('sidebar', sidebarOpen ? '1' : '0'), [sidebarOpen]);

  const toggleTheme = useCallback(() => {
    const flip = () => flushSync(() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')));
    if (document.startViewTransition) document.startViewTransition(flip);
    else flip();
  }, []);
  const toggleLang = useCallback(() => setLang((prev) => (prev === 'zh' ? 'en' : 'zh')), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const { exp: state, doc: current, time: now } = live.current;
      if (state.status === 'running') {
        if (event.key === 'Escape') cancelExport();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        pickFile();
        return;
      }
      if (!current || event.ctrlKey || event.metaKey || event.altKey) return;
      // A focused button keeps its own Space/Enter.
      if (tag === 'BUTTON' && (event.key === ' ' || event.key === 'Enter')) return;

      const step = event.shiftKey ? 1 : 1 / (current.info.video.fps || 30);
      switch (event.key) {
        case ' ':
          event.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          event.preventDefault();
          if (videoRef.current) videoRef.current.pause();
          seek(clamp(now + (event.key === 'ArrowLeft' ? -step : step), 0, current.info.duration));
          break;
        case 'm':
        case 'M':
          toggleMute();
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          event.preventDefault();
          setMuted(false);
          setVolume((prev) => clamp(Math.round((prev + (event.key === 'ArrowUp' ? 0.05 : -0.05)) * 100) / 100, 0, 1));
          wakeStage();
          break;
        case 'j':
        case 'J':
          skipBy(-1);
          break;
        case 'l':
        case 'L':
          skipBy(1);
          break;
        case 'i':
        case 'I':
          markEdge('start');
          break;
        case 'o':
        case 'O':
          markEdge('end');
          break;
        case 's':
        case 'S':
          addRange();
          break;
        case 'Delete':
        case 'Backspace':
          removeRange();
          break;
        case 'Enter':
          runExport();
          break;
        case 'Escape':
          dismissResult();
          break;
        default:
      }
    };
    // Mouse clicks should not leave focus on a button, or Space would press it again instead of playing.
    const dropFocus = () => {
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', dropFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', dropFocus);
    };
  }, [togglePlay, skipBy, toggleMute, wakeStage, seek, markEdge, addRange, removeRange, runExport, dismissResult, cancelExport, pickFile]);

  useEffect(() => {
    const hasFiles = (event) => event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
    const onOver = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDropping(true);
    };
    const onLeave = (event) => {
      if (!event.relatedTarget) setDropping(false);
    };
    const onDrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDropping(false);
      const file = event.dataTransfer.files[0];
      const filePath = file && api.pathForFile(file);
      if (filePath) openFile(filePath);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [openFile]);

  const length = useMemo(() => totalLength(segments), [segments]);
  const zoomed = view.end - view.start < duration - 1e-6;
  const busyText = load.status === 'loading' ? (load.percent !== undefined ? t.buildingPreview(Math.round(load.percent)) : t.loading) : null;

  return (
    <I18nContext.Provider value={t}>
      <MotionConfig reducedMotion="user">
        <Backdrop quiet={playing || locked} />
        <div className="app">
          <TitleBar
            fileName={doc ? doc.name : ''}
            theme={theme}
            onTheme={toggleTheme}
            onLang={toggleLang}
            onSidebar={toggleSidebar}
            sidebarOpen={sidebarOpen}
            onOpenFile={pickFile}
            platform={api.platform}
          />

          <div className="body">
            <AnimatePresence initial={false}>
              {sidebarOpen && (
                <motion.div
                  key="sidebar"
                  className={`sidebar-slot${locked ? ' is-locked' : ''}`}
                  inert={locked}
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 312, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                >
                  <Library
                    trees={trees}
                    expanded={expanded}
                    onToggle={toggleDir}
                    filter={filter}
                    onFilter={setFilter}
                    currentPath={doc ? doc.path : null}
                    destPath={dest}
                    onOpen={openFile}
                    onAddRoot={addRoot}
                    onRemoveRoot={removeRoot}
                    onMove={moveFile}
                    onRename={renameFile}
                    onTrash={trashFile}
                    onShow={showPath}
                    onSetDest={setDest}
                    notice={notice}
                    lang={lang}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <main className="workspace">
              <section
                className={`stage${doc ? '' : ' is-empty glass'}${dropping ? ' is-dropping' : ''}`}
                onPointerMove={wakeStage}
                onPointerLeave={sleepStage}
              >
                <AnimatePresence>
                  {doc && src && (
                    <motion.video
                      key={src}
                      ref={(el) => {
                        if (el) videoRef.current = el;
                      }}
                      className="video"
                      src={src}
                      preload="auto"
                      playsInline
                      onClick={togglePlay}
                      onLoadedData={(event) => (event.currentTarget.videoWidth ? setLoad({ status: 'ready' }) : escalate())}
                      onError={escalate}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onEnded={() => setPlaying(false)}
                      onSeeked={onSeeked}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: load.status === 'ready' ? 1 : 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.22 }}
                    />
                  )}
                </AnimatePresence>

                {doc && load.status === 'ready' && (
                  <StageControls
                    visible={stageHot && !locked}
                    playing={playing}
                    skip={skip}
                    onToggle={togglePlay}
                    onSkip={skipBy}
                    onSkipChange={setSkip}
                    volume={volume}
                    muted={muted}
                    onVolume={changeVolume}
                    onMute={toggleMute}
                    rate={rate}
                    onRate={setRate}
                  />
                )}

                <AnimatePresence>
                  {busyText && (
                    <motion.p key="busy" className="stage-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      {busyText}
                    </motion.p>
                  )}
                  {doc && load.status === 'error' && (
                    <motion.p key="error" className="stage-note is-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      {load.message}
                    </motion.p>
                  )}
                  {!doc && load.status !== 'loading' && (
                    <motion.div
                      key="empty"
                      className="empty-stage"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {load.status === 'error' && <p className="empty-error">{load.message}</p>}
                      <h2>{dropping ? t.dropActive : t.dropTitle}</h2>
                      <p>{t.dropHint}</p>
                      <button type="button" className="primary-button" onClick={pickFile}>
                        {t.openVideo}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              <AnimatePresence initial={false}>
                {doc && (
                  <motion.section
                    key="deck"
                    className="deck glass"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                  >
                    <div className={`deck-edit${locked ? ' is-locked' : ''}`} inert={locked}>
                      <div className="transport">
                        <button
                          type="button"
                          className="play-button"
                          onClick={togglePlay}
                          disabled={load.status !== 'ready'}
                          aria-label={playing ? t.pause : t.play}
                          title={playing ? t.pause : t.play}
                        >
                          {playing ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
                        </button>
                        <p className="clock num">
                          <span>{formatTime(time)}</span>
                          <span className="clock-total"> / {formatTime(duration)}</span>
                        </p>
                        <div className="tools">
                          <button type="button" className="icon-button" onClick={addRange} aria-label={t.addRange} title={t.addRange}>
                            <Plus size={16} strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={removeRange}
                            disabled={segments.length < 2}
                            aria-label={t.removeRange}
                            title={t.removeRange}
                          >
                            <Trash2 size={16} strokeWidth={1.5} />
                          </button>
                          <span className="tools-gap" />
                          <button type="button" className="icon-button" onClick={() => zoom(2)} disabled={!zoomed} aria-label={t.zoomOut} title={t.zoomOut}>
                            <ZoomOut size={16} strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => setView({ start: 0, end: duration })}
                            disabled={!zoomed}
                            aria-label={t.zoomFit}
                            title={t.zoomFit}
                          >
                            <Maximize2 size={16} strokeWidth={1.5} />
                          </button>
                          <button type="button" className="icon-button" onClick={() => zoom(0.5)} aria-label={t.zoomIn} title={t.zoomIn}>
                            <ZoomIn size={16} strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>

                      <Timeline
                        src={load.status === 'ready' ? src : null}
                        duration={duration}
                        fps={fps}
                        aspect={doc.info.video.width / Math.max(1, doc.info.video.height)}
                        view={view}
                        onView={setView}
                        segments={segments}
                        activeId={activeId}
                        onActivate={setActiveId}
                        onEdge={onEdge}
                        currentTime={time}
                        onSeek={seek}
                        keyframes={keyframes}
                      />
                    </div>

                    <ExportBar
                      segments={segments}
                      length={length}
                      plan={plan}
                      canSnap={Boolean(keyframes && keyframes.length)}
                      onSnap={snapToKeyframes}
                      dest={dest}
                      onDest={setDest}
                      onChooseDest={chooseDest}
                      state={exp}
                      onExport={runExport}
                      onCancel={cancelExport}
                      onShow={showResult}
                      onDismiss={dismissResult}
                    />
                  </motion.section>
                )}
              </AnimatePresence>
            </main>
          </div>
        </div>
      </MotionConfig>
    </I18nContext.Provider>
  );
}
