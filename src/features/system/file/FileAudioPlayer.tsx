"use client";

import {
  AudioMutedOutlined,
  AudioOutlined,
  CloseOutlined,
  DownloadOutlined,
  MinusOutlined,
  PauseCircleFilled,
  PlayCircleFilled,
  ReloadOutlined,
  SoundOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from "@ant-design/icons";
import { Button, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PreviewFileRecord } from "./FilePreviewModal";

const STORAGE_KEY = "admin-base-file-audio-player-position";
const PLAYER_WIDTH = 440;
const PLAYER_HEIGHT = 286;
const PLAYER_MINIMIZED_HEIGHT = 42;
const PLAYER_MARGIN = 16;
const SKIP_SECONDS = 10;
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

type PlayerPosition = {
  left: number;
  top: number;
};

type DragState = {
  offsetX: number;
  offsetY: number;
};

type AudioLoadStatus = "idle" | "loading" | "ready" | "error";

type AudioPlaybackState = {
  fileId: number | null;
  loadStatus: AudioLoadStatus;
  playing: boolean;
  currentTime: number;
  duration: number;
};

const EMPTY_AUDIO_STATE: AudioPlaybackState = {
  fileId: null,
  loadStatus: "idle",
  playing: false,
  currentTime: 0,
  duration: 0,
};

function getFileUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minute = Math.floor(seconds / 60);
  const second = Math.floor(seconds % 60);
  return `${minute}:${String(second).padStart(2, "0")}`;
}

function getAudioDuration(audio: HTMLAudioElement | null, fallback: number) {
  const audioDuration = audio?.duration ?? 0;
  if (Number.isFinite(audioDuration) && audioDuration > 0) return audioDuration;
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 0;
}

function readStoredPosition(): PlayerPosition | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PlayerPosition;
    if (!Number.isFinite(value.left) || !Number.isFinite(value.top)) return null;
    return clampPosition(value, false);
  } catch {
    return null;
  }
}

function clampPosition(position: PlayerPosition, minimized: boolean): PlayerPosition {
  if (typeof window === "undefined") return position;

  const maxLeft = Math.max(PLAYER_MARGIN, window.innerWidth - PLAYER_WIDTH - PLAYER_MARGIN);
  const maxTop = Math.max(
    PLAYER_MARGIN,
    window.innerHeight - (minimized ? PLAYER_MINIMIZED_HEIGHT : PLAYER_HEIGHT) - PLAYER_MARGIN,
  );

  return {
    left: Math.min(Math.max(PLAYER_MARGIN, position.left), maxLeft),
    top: Math.min(Math.max(PLAYER_MARGIN, position.top), maxTop),
  };
}

export function FileAudioPlayer({
  file,
  onClose,
  onDownload,
}: {
  file: PreviewFileRecord | null;
  onClose: () => void;
  onDownload?: (file: PreviewFileRecord) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const seekingRef = useRef(false);
  const [position, setPosition] = useState<PlayerPosition | null>(() => readStoredPosition());
  const [minimized, setMinimized] = useState(false);
  const [audioState, setAudioState] = useState<AudioPlaybackState>(EMPTY_AUDIO_STATE);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const currentFileId = file?.id ?? null;
  const audioUrl = useMemo(() => (file ? getFileUrl(file.url) : ""), [file]);
  const isCurrentAudioState = audioState.fileId === currentFileId;
  const loadStatus: AudioLoadStatus = isCurrentAudioState
    ? audioState.loadStatus
    : currentFileId
      ? "loading"
      : "idle";
  const playing = isCurrentAudioState ? audioState.playing : false;
  const currentTime = isCurrentAudioState ? audioState.currentTime : 0;
  const duration = isCurrentAudioState ? audioState.duration : 0;
  const durationReady = duration > 0;
  const progressDisabled = !durationReady || loadStatus === "error";
  const effectivePosition = position ? clampPosition(position, minimized) : null;
  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const volumePercent = muted ? 0 : volume;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume / 100;
    audio.muted = muted;
    audio.playbackRate = playbackRate;
  }, [audioUrl, muted, playbackRate, volume]);

  if (!file) return null;

  function updateAudioState(nextState: Partial<Omit<AudioPlaybackState, "fileId">>) {
    setAudioState((previousState) => {
      const baseState =
        previousState.fileId === currentFileId
          ? previousState
          : {
              fileId: currentFileId,
              loadStatus: "loading" as const,
              playing: false,
              currentTime: 0,
              duration: 0,
            };

      return {
        ...baseState,
        ...nextState,
        fileId: currentFileId,
      };
    });
  }

  function persistPosition(nextPosition: PlayerPosition) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextPosition));
    } catch {
      // Position persistence is optional.
    }
  }

  function updatePosition(nextPosition: PlayerPosition) {
    const clamped = clampPosition(nextPosition, minimized);
    setPosition(clamped);
    persistPosition(clamped);
  }

  function handleMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const panel = event.currentTarget.closest<HTMLElement>(".system-audio-float-player");
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const nextPosition = { left: rect.left, top: rect.top };
    setPosition(nextPosition);
    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    event.preventDefault();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current) return;
      updatePosition({
        left: moveEvent.clientX - dragRef.current.offsetX,
        top: moveEvent.clientY - dragRef.current.offsetY,
      });
    };
    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }

  function seekTo(seconds: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    const nextDuration = getAudioDuration(audio, duration);
    if (nextDuration <= 0) return;
    const nextTime =
      nextDuration > 0 ? Math.min(Math.max(0, seconds), nextDuration) : Math.max(0, seconds);
    audio.currentTime = nextTime;
    updateAudioState({ currentTime: nextTime, duration: nextDuration, loadStatus: "ready" });
  }

  function startSeeking() {
    seekingRef.current = true;
  }

  function seekFromClientX(clientX: number, target: HTMLInputElement) {
    const rect = target.getBoundingClientRect();
    const nextDuration = getAudioDuration(audioRef.current, duration);
    if (rect.width <= 0 || nextDuration <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekTo(ratio * nextDuration);
  }

  function handleProgressPointerDown(event: React.PointerEvent<HTMLInputElement>) {
    if (progressDisabled) return;
    event.preventDefault();
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture only improves drag continuity; seeking still works without it.
    }
    startSeeking();
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function handleProgressPointerMove(event: React.PointerEvent<HTMLInputElement>) {
    if (!seekingRef.current) return;
    event.preventDefault();
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function handleProgressPointerUp(event: React.PointerEvent<HTMLInputElement>) {
    if (seekingRef.current) {
      event.preventDefault();
      seekFromClientX(event.clientX, event.currentTarget);
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Some browsers release capture automatically.
      }
    }
    endSeeking();
  }

  function endSeeking() {
    seekingRef.current = false;
    updateAudioState({ currentTime: audioRef.current?.currentTime ?? currentTime });
  }

  function handleProgressInput(value: number) {
    if (progressDisabled) return;
    seekTo(value);
  }

  function skip(seconds: number) {
    seekTo((audioRef.current?.currentTime ?? currentTime) + seconds);
  }

  function reloadAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    updateAudioState({ loadStatus: "loading", playing: false, currentTime: 0, duration: 0 });
    audio.load();
    void audio.play().catch(() => undefined);
  }

  function updateVolume(nextVolume: number) {
    const normalized = Math.min(Math.max(0, nextVolume), 100);
    const audio = audioRef.current;
    setVolume(normalized);
    setMuted(normalized === 0);
    if (audio) {
      audio.volume = normalized / 100;
      audio.muted = normalized === 0;
    }
  }

  function toggleMuted() {
    const audio = audioRef.current;
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (audio) audio.muted = nextMuted;
  }

  function updatePlaybackRate(nextRate: number) {
    const audio = audioRef.current;
    setPlaybackRate(nextRate);
    if (audio) audio.playbackRate = nextRate;
  }

  const style = effectivePosition
    ? { left: effectivePosition.left, top: effectivePosition.top }
    : { bottom: PLAYER_MARGIN, right: PLAYER_MARGIN };

  return (
    <div
      className={`system-audio-float-player${minimized ? " is-minimized" : ""}`}
      style={style}
      role="dialog"
      aria-label="音频播放器"
    >
      <audio
        ref={audioRef}
        key={file.id}
        src={audioUrl}
        autoPlay
        preload="metadata"
        onLoadStart={() =>
          updateAudioState({ loadStatus: "loading", playing: false, currentTime: 0, duration: 0 })
        }
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          const nextDuration = getAudioDuration(audio, 0);
          audio.volume = volume / 100;
          audio.muted = muted;
          audio.playbackRate = playbackRate;
          updateAudioState({
            duration: nextDuration,
            currentTime: audio.currentTime || 0,
            playing: !audio.paused,
            loadStatus: nextDuration > 0 ? "ready" : "loading",
          });
        }}
        onDurationChange={(event) => {
          const nextDuration = getAudioDuration(event.currentTarget, 0);
          updateAudioState({
            duration: nextDuration,
            loadStatus: nextDuration > 0 ? "ready" : "loading",
          });
        }}
        onCanPlay={(event) => {
          const nextDuration = getAudioDuration(event.currentTarget, duration);
          updateAudioState({
            duration: nextDuration,
            loadStatus: nextDuration > 0 ? "ready" : "loading",
          });
        }}
        onTimeUpdate={(event) => {
          if (!seekingRef.current)
            updateAudioState({ currentTime: event.currentTarget.currentTime });
        }}
        onPlay={() => updateAudioState({ playing: true })}
        onPause={() => updateAudioState({ playing: false })}
        onEnded={(event) =>
          updateAudioState({
            playing: false,
            currentTime: getAudioDuration(event.currentTarget, duration),
          })
        }
        onError={() => updateAudioState({ loadStatus: "error", playing: false })}
      />
      <div className="system-audio-float-header" onMouseDown={handleMouseDown}>
        <Typography.Text ellipsis className="system-audio-float-title">
          {file.originalName}
        </Typography.Text>
        <div
          className="system-audio-window-actions"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Tooltip title={minimized ? "展开" : "收起"}>
            <Button
              aria-label={minimized ? "展开播放器" : "收起播放器"}
              type="text"
              size="small"
              icon={<MinusOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                setMinimized((value) => !value);
              }}
            />
          </Tooltip>
          <Tooltip title="关闭">
            <Button
              aria-label="关闭播放器"
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            />
          </Tooltip>
        </div>
      </div>

      {!minimized ? (
        <div className="system-audio-float-body">
          <div className="system-audio-main-controls">
            <Tooltip title={`后退 ${SKIP_SECONDS} 秒`}>
              <button
                type="button"
                className="system-audio-skip-button"
                onClick={() => skip(-SKIP_SECONDS)}
              >
                <StepBackwardOutlined />
              </button>
            </Tooltip>
            <button
              type="button"
              className="system-audio-play-button"
              aria-label={playing ? "暂停" : "播放"}
              onClick={togglePlayback}
            >
              {playing ? <PauseCircleFilled /> : <PlayCircleFilled />}
            </button>
            <Tooltip title={`前进 ${SKIP_SECONDS} 秒`}>
              <button
                type="button"
                className="system-audio-skip-button"
                onClick={() => skip(SKIP_SECONDS)}
              >
                <StepForwardOutlined />
              </button>
            </Tooltip>
          </div>

          <div className="system-audio-progress-row">
            <span>{formatTime(currentTime)}</span>
            <input
              aria-label="播放进度"
              type="range"
              min={0}
              max={durationReady ? duration : 0}
              step={0.1}
              value={durationReady ? Math.min(currentTime, duration) : 0}
              disabled={progressDisabled}
              className="system-audio-range system-audio-progress"
              style={{ "--progress": `${progressPercent}%` } as React.CSSProperties}
              onPointerDown={handleProgressPointerDown}
              onPointerMove={handleProgressPointerMove}
              onPointerUp={handleProgressPointerUp}
              onPointerCancel={endSeeking}
              onInput={(event) => handleProgressInput(Number(event.currentTarget.value))}
              onChange={(event) => handleProgressInput(Number(event.target.value))}
            />
            <span className={durationReady ? undefined : "system-audio-duration-status"}>
              {durationReady ? (
                formatTime(duration)
              ) : loadStatus === "error" ? (
                <Tooltip title="重新加载音频">
                  <button type="button" className="system-audio-retry-button" onClick={reloadAudio}>
                    <ReloadOutlined />
                  </button>
                </Tooltip>
              ) : (
                "加载中"
              )}
            </span>
          </div>

          <div className="system-audio-tools">
            <button
              type="button"
              className="system-audio-icon-button"
              aria-label="静音"
              onClick={toggleMuted}
            >
              {muted || volume === 0 ? <AudioMutedOutlined /> : <SoundOutlined />}
            </button>
            <input
              aria-label="音量"
              type="range"
              min={0}
              max={100}
              value={volumePercent}
              className="system-audio-range system-audio-volume"
              style={{ "--progress": `${volumePercent}%` } as React.CSSProperties}
              onInput={(event) => updateVolume(Number(event.currentTarget.value))}
              onChange={(event) => updateVolume(Number(event.target.value))}
            />
            <label className="system-audio-rate">
              <span>倍速</span>
              <select
                aria-label="播放倍速"
                value={playbackRate}
                onChange={(event) => updatePlaybackRate(Number(event.target.value))}
              >
                {SPEED_OPTIONS.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}x
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="system-audio-current-row">
            <AudioOutlined />
            <Typography.Text ellipsis>{file.originalName}</Typography.Text>
            <Tooltip title="下载">
              <Button
                aria-label="下载音频"
                type="text"
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => onDownload?.(file)}
              />
            </Tooltip>
          </div>
        </div>
      ) : (
        <div className="system-audio-mini-controls">
          <button
            type="button"
            className="system-audio-mini-play"
            aria-label={playing ? "暂停" : "播放"}
            onClick={togglePlayback}
          >
            {playing ? <PauseCircleFilled /> : <PlayCircleFilled />}
          </button>
          <span>{formatTime(currentTime)}</span>
        </div>
      )}
    </div>
  );
}
