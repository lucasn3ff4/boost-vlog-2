import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Timeline as TimelineEditor, type TimelineState } from "@xzdarcy/react-timeline-editor";
import "@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css";
import { useTimelineStore } from "../stores/timelineStore";
import { toEditorData, timelineSecondsToFrame, type VideoAction, type MusicAction, type TitleAction, type CaptionAction, type TimestampAction, type SubscribeAction, type AnalyzeAction } from "../lib/remotion";

const effects = {
  video: {
    id: "video",
    name: "Video",
  },
  music: {
    id: "music",
    name: "Music",
  },
  title: {
    id: "title",
    name: "Title",
  },
  caption: {
    id: "caption",
    name: "Caption",
  },
  timestamp: {
    id: "timestamp",
    name: "Timestamp",
  },
  tracker: {
    id: "tracker",
    name: "Tracker",
  },
  subscribe: {
    id: "subscribe",
    name: "Subscribe",
  },
  zoom: {
    id: "zoom",
    name: "Slow Zoom",
  },
  enlarge: {
    id: "enlarge",
    name: "Enlarge",
  },
  analyze: {
    id: "analyze",
    name: "Analyze",
  },
};

const SCALE = 5; // seconds per tick
const MIN_SCALE_WIDTH = 20;
const MAX_SCALE_WIDTH = 500;
const DEFAULT_SCALE_WIDTH = 160;

export function Timeline() {
  const {
    project, timelineItems, setTimelineItems, musicItems, playerRef,
    setMusicItems, setVolumeEnvelope, musicLoading, setMusicLoading,
    titleItems, setTitleItems, titleLoading, setTitleLoading, updateTitleItem,
    captionItems, setCaptionItems, captionLoading, setCaptionLoading, updateCaptionItem,
    timestampItems, setTimestampItems, timestampLoading, setTimestampLoading, updateTimestampItem,
    trackerItems, setTrackerItems, trackerLoading, setTrackerLoading,
    subscribeItems, setSubscribeItems, subscribeLoading, setSubscribeLoading, updateSubscribeItem,
    zoomItems, setZoomItems, zoomLoading, setZoomLoading,
    enlargeItems, setEnlargeItems, enlargeLoading, setEnlargeLoading,
    analyzeItems, setAnalyzeItems, analyzeLoading, setAnalyzeLoading,
    remixLoading, setRemixLoading,
    hookLoading, setHookLoading,
  } = useTimelineStore();
  const timelineRef = useRef<TimelineState>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const syncingFromPlayer = useRef(false);
  const [scaleWidth, setScaleWidth] = useState(DEFAULT_SCALE_WIDTH);
  const [autoFit, setAutoFit] = useState(true);

  const [editingTitleId, setEditingTitleId] = useState<number | null>(null);
  const [editingTitleText, setEditingTitleText] = useState("");
  const [editingCaptionId, setEditingCaptionId] = useState<number | null>(null);
  const [editingCaptionText, setEditingCaptionText] = useState("");
  const [editingTimestampId, setEditingTimestampId] = useState<number | null>(null);
  const [editingTimestampText, setEditingTimestampText] = useState("");
  const [selectedAnalyzeId, setSelectedAnalyzeId] = useState<number | null>(null);
  const [selectedAnalyzeText, setSelectedAnalyzeText] = useState("");
  const [analyzePopupPos, setAnalyzePopupPos] = useState<{ x: number; y: number } | null>(null);

  const { rows, totalDuration } = useMemo(
    () => toEditorData(timelineItems, musicItems, titleItems, captionItems, timestampItems, trackerItems, subscribeItems, zoomItems, enlargeItems, analyzeItems),
    [timelineItems, musicItems, titleItems, captionItems, timestampItems, trackerItems, subscribeItems, zoomItems, enlargeItems, analyzeItems]
  );

  // Auto-fit: calculate scaleWidth so all clips fit in the container
  useEffect(() => {
    if (!autoFit || totalDuration === 0 || !wrapperRef.current) return;
    const containerWidth = wrapperRef.current.clientWidth - 40; // padding
    const numTicks = totalDuration / SCALE;
    if (numTicks > 0) {
      const fitted = Math.max(MIN_SCALE_WIDTH, Math.min(MAX_SCALE_WIDTH, containerWidth / numTicks));
      setScaleWidth(fitted);
    }
  }, [autoFit, totalDuration]);

  // Option + scroll wheel to zoom
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      setAutoFit(false);
      setScaleWidth((prev) => {
        const delta = e.deltaY > 0 ? -10 : 10;
        return Math.max(MIN_SCALE_WIDTH, Math.min(MAX_SCALE_WIDTH, prev + delta));
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Sync Remotion Player frame -> timeline cursor
  useEffect(() => {
    const player = playerRef?.current;
    if (!player) return;

    const handler = () => {
      if (syncingFromPlayer.current) return;
      const frame = player.getCurrentFrame();
      let cursor = 0;
      let frameCursor = 0;
      for (const item of timelineItems) {
        if (item.duration < 0.034) continue;
        const frames = Math.max(Math.round(item.duration * 30), 1);
        if (frame < frameCursor + frames) {
          const offset = (frame - frameCursor) / 30;
          const time = cursor + offset;
          timelineRef.current?.setTime(time);
          return;
        }
        cursor += item.duration;
        frameCursor += frames;
      }
      timelineRef.current?.setTime(cursor);
    };

    player.addEventListener("frameupdate", handler);
    return () => player.removeEventListener("frameupdate", handler);
  }, [playerRef, timelineItems]);

  const handleCursorDrag = useCallback((time: number) => {
    syncingFromPlayer.current = true;
    const frame = timelineSecondsToFrame(time, timelineItems);
    playerRef?.current?.seekTo(frame);
    requestAnimationFrame(() => {
      syncingFromPlayer.current = false;
    });
  }, [playerRef, timelineItems]);

  const handleClickTimeArea = useCallback((time: number) => {
    handleCursorDrag(time);
    return true;
  }, [handleCursorDrag]);

  const handleAddMusic = async () => {
    if (!project) return;
    setMusicLoading(true);
    try {
      const res = await fetch(`/api/music/${project.id}/auto`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setMusicItems(data.items);
        setVolumeEnvelope(data.volume_envelope);
      }
    } finally {
      setMusicLoading(false);
    }
  };

  const handleClearMusic = async () => {
    if (!project) return;
    await fetch(`/api/music/${project.id}`, { method: "DELETE" });
    setMusicItems([]);
    setVolumeEnvelope([]);
  };

  const handleAddTitles = async () => {
    if (!project) return;
    setTitleLoading(true);
    try {
      const res = await fetch(`/api/titles/${project.id}/auto`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setTitleItems(data.items);
      }
    } finally {
      setTitleLoading(false);
    }
  };

  const handleClearTitles = async () => {
    if (!project) return;
    await fetch(`/api/titles/${project.id}`, { method: "DELETE" });
    setTitleItems([]);
  };

  const handleSaveTitle = async (titleId: number, text: string) => {
    if (!project) return;
    updateTitleItem(titleId, { text });
    setEditingTitleId(null);
    await fetch(`/api/titles/${project.id}/items/${titleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  };

  const handleAddCaptions = async () => {
    if (!project) return;
    setCaptionLoading(true);
    try {
      const res = await fetch(`/api/captions/${project.id}/auto`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setCaptionItems(data.items);
      }
    } finally {
      setCaptionLoading(false);
    }
  };

  const handleClearCaptions = async () => {
    if (!project) return;
    await fetch(`/api/captions/${project.id}`, { method: "DELETE" });
    setCaptionItems([]);
  };

  const handleSaveCaption = async (captionId: number, text: string) => {
    if (!project) return;
    updateCaptionItem(captionId, { text });
    setEditingCaptionId(null);
    await fetch(`/api/captions/${project.id}/items/${captionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  };

  const handleAddTimestamps = async () => {
    if (!project) return;
    setTimestampLoading(true);
    try {
      const res = await fetch(`/api/timestamps/${project.id}/auto`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setTimestampItems(data.items);
      }
    } finally {
      setTimestampLoading(false);
    }
  };

  const handleClearTimestamps = async () => {
    if (!project) return;
    await fetch(`/api/timestamps/${project.id}`, { method: "DELETE" });
    setTimestampItems([]);
  };

  const handleSaveTimestamp = async (timestampId: number, text: string) => {
    if (!project) return;
    updateTimestampItem(timestampId, { text });
    setEditingTimestampId(null);
    await fetch(`/api/timestamps/${project.id}/items/${timestampId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  };

  const handleAddTrackers = async () => {
    if (!project) return;
    setTrackerLoading(true);
    try {
      const res = await fetch(`/api/trackers/${project.id}/auto`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setTrackerItems(data.items);
      }
    } finally {
      setTrackerLoading(false);
    }
  };

  const handleClearTrackers = async () => {
    if (!project) return;
    await fetch(`/api/trackers/${project.id}`, { method: "DELETE" });
    setTrackerItems([]);
  };

  const handleAddSubscribe = async () => {
    if (!project) return;
    setSubscribeLoading(true);
    try {
      const res = await fetch(`/api/subscribes/${project.id}/auto`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSubscribeItems(data.items);
      }
    } finally {
      setSubscribeLoading(false);
    }
  };

  const handleClearSubscribe = async () => {
    if (!project) return;
    await fetch(`/api/subscribes/${project.id}`, { method: "DELETE" });
    setSubscribeItems([]);
  };

  const handleAddZoom = async () => {
    if (!project) return;
    setZoomLoading(true);
    try {
      const res = await fetch(`/api/zooms/${project.id}/auto`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setZoomItems(data.items);
      }
    } finally {
      setZoomLoading(false);
    }
  };

  const handleClearZoom = async () => {
    if (!project) return;
    await fetch(`/api/zooms/${project.id}`, { method: "DELETE" });
    setZoomItems([]);
  };

  const handleAddEnlarge = async () => {
    if (!project) return;
    setEnlargeLoading(true);
    try {
      const res = await fetch(`/api/enlarges/${project.id}/auto`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setEnlargeItems(data.items);
      }
    } finally {
      setEnlargeLoading(false);
    }
  };

  const handleClearEnlarge = async () => {
    if (!project) return;
    await fetch(`/api/enlarges/${project.id}`, { method: "DELETE" });
    setEnlargeItems([]);
  };

  const handleAddAnalyze = async () => {
    if (!project) return;
    setAnalyzeLoading(true);
    const res = await fetch(`/api/analyzes/${project.id}/auto`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      alert(err?.detail || "Failed to analyze b-roll");
      setAnalyzeLoading(false);
    }
    // Loading cleared by WebSocket "analyze_done" event
  };

  const handleCancelAnalyze = async () => {
    if (!project) return;
    await fetch(`/api/analyzes/${project.id}/cancel`, { method: "POST" });
  };

  const handleClearAnalyze = async () => {
    if (!project) return;
    await fetch(`/api/analyzes/${project.id}`, { method: "DELETE" });
    setAnalyzeItems([]);
  };

  const handleAddRemixes = async () => {
    if (!project) return;
    setRemixLoading(true);
    try {
      const res = await fetch(`/api/remixes/${project.id}/auto`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setTimelineItems(data.items);
        // Re-fetch analyze items since their times were shifted
        const analyzeRes = await fetch(`/api/analyzes/${project.id}`);
        if (analyzeRes.ok) {
          const analyzeData = await analyzeRes.json();
          setAnalyzeItems(analyzeData.items);
        }
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.detail || "Failed to generate remixes");
      }
    } finally {
      setRemixLoading(false);
    }
  };

  const handleClearRemixes = async () => {
    if (!project) return;
    const res = await fetch(`/api/remixes/${project.id}`, { method: "DELETE" });
    if (res.ok) {
      const data = await res.json();
      setTimelineItems(data.items);
      const analyzeRes = await fetch(`/api/analyzes/${project.id}`);
      if (analyzeRes.ok) {
        const analyzeData = await analyzeRes.json();
        setAnalyzeItems(analyzeData.items);
      }
    }
  };

  const refreshOverlays = async () => {
    if (!project) return;
    const id = project.id;
    const [music, titles, captions, timestamps, trackers, subscribes, zooms, enlarges, analyzes] = await Promise.all([
      fetch(`/api/music/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/titles/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/captions/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/timestamps/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/trackers/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/subscribes/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/zooms/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/enlarges/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/analyzes/${id}`).then(r => r.ok ? r.json() : null),
    ]);
    if (music) { setMusicItems(music.items); setVolumeEnvelope(music.volume_envelope); }
    if (titles) setTitleItems(titles.items);
    if (captions) setCaptionItems(captions.items);
    if (timestamps) setTimestampItems(timestamps.items);
    if (trackers) setTrackerItems(trackers.items);
    if (subscribes) setSubscribeItems(subscribes.items);
    if (zooms) setZoomItems(zooms.items);
    if (enlarges) setEnlargeItems(enlarges.items);
    if (analyzes) setAnalyzeItems(analyzes.items);
  };

  const handleAddHook = async () => {
    if (!project) return;
    setHookLoading(true);
    try {
      const res = await fetch(`/api/hooks/${project.id}/auto`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setTimelineItems(data.items);
        await refreshOverlays();
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.detail || "Failed to generate hook");
      }
    } finally {
      setHookLoading(false);
    }
  };

  const handleClearHook = async () => {
    if (!project) return;
    const res = await fetch(`/api/hooks/${project.id}`, { method: "DELETE" });
    if (res.ok) {
      const data = await res.json();
      setTimelineItems(data.items);
      await refreshOverlays();
    }
  };

  if (!project) return null;

  const trackLabels = useMemo(() => {
    const labels: { id: string; track: string; label: string; hasItems: boolean; loading: boolean; onAdd: () => void; onClear: () => void; onCancel?: () => void }[] = [];
    for (const row of rows) {
      if (row.id === "video-track") {
        const hasRemixes = timelineItems.some(i => i.clip_type === "remix");
        labels.push({ id: row.id, track: "remix", label: "Remixes", hasItems: hasRemixes, loading: remixLoading, onAdd: handleAddRemixes, onClear: handleClearRemixes });
      } else if (row.id === "music-track") {
        labels.push({ id: row.id, track: "music", label: "Music", hasItems: musicItems.length > 0, loading: musicLoading, onAdd: handleAddMusic, onClear: handleClearMusic });
      } else if (row.id === "title-track") {
        labels.push({ id: row.id, track: "title", label: "Titles", hasItems: titleItems.length > 0, loading: titleLoading, onAdd: handleAddTitles, onClear: handleClearTitles });
      } else if (row.id === "caption-track") {
        labels.push({ id: row.id, track: "caption", label: "Captions", hasItems: captionItems.length > 0, loading: captionLoading, onAdd: handleAddCaptions, onClear: handleClearCaptions });
      } else if (row.id === "timestamp-track") {
        labels.push({ id: row.id, track: "timestamp", label: "Timestamps", hasItems: timestampItems.length > 0, loading: timestampLoading, onAdd: handleAddTimestamps, onClear: handleClearTimestamps });
      } else if (row.id === "tracker-track") {
        labels.push({ id: row.id, track: "tracker", label: "Trackers", hasItems: trackerItems.length > 0, loading: trackerLoading, onAdd: handleAddTrackers, onClear: handleClearTrackers });
      } else if (row.id === "subscribe-track") {
        labels.push({ id: row.id, track: "subscribe", label: "Subscribe", hasItems: subscribeItems.length > 0, loading: subscribeLoading, onAdd: handleAddSubscribe, onClear: handleClearSubscribe });
      } else if (row.id === "zoom-track") {
        labels.push({ id: row.id, track: "zoom", label: "Slow Zoom", hasItems: zoomItems.length > 0, loading: zoomLoading, onAdd: handleAddZoom, onClear: handleClearZoom });
      } else if (row.id === "enlarge-track") {
        labels.push({ id: row.id, track: "enlarge", label: "Enlarge", hasItems: enlargeItems.length > 0, loading: enlargeLoading, onAdd: handleAddEnlarge, onClear: handleClearEnlarge });
      } else if (row.id === "analyze-track") {
        labels.push({ id: row.id, track: "analyze", label: "Analyze", hasItems: analyzeItems.length > 0, loading: analyzeLoading, onAdd: handleAddAnalyze, onClear: handleClearAnalyze, onCancel: handleCancelAnalyze });
      }
    }
    return labels;
  }, [rows, timelineItems, musicItems, titleItems, captionItems, timestampItems, trackerItems, subscribeItems, zoomItems, enlargeItems, analyzeItems, remixLoading, musicLoading, titleLoading, captionLoading, timestampLoading, trackerLoading, subscribeLoading, zoomLoading, enlargeLoading, analyzeLoading]);

  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <h3>Timeline</h3>
        <div className="timeline-controls">
          <label className="timeline-autofit">
            <input
              type="checkbox"
              checked={autoFit}
              onChange={(e) => {
                setAutoFit(e.target.checked);
                if (e.target.checked && totalDuration > 0 && wrapperRef.current) {
                  const containerWidth = wrapperRef.current.clientWidth - 40;
                  const numTicks = totalDuration / SCALE;
                  if (numTicks > 0) {
                    setScaleWidth(Math.max(MIN_SCALE_WIDTH, Math.min(MAX_SCALE_WIDTH, containerWidth / numTicks)));
                  }
                }
              }}
            />
            Fit all
          </label>
          <span className="timeline-duration">{totalDuration.toFixed(1)}s</span>
          {timelineItems.length > 0 && (
            <button
              className={`timeline-hook-btn ${hookLoading ? "loading" : ""}`}
              onClick={timelineItems.some(i => i.label?.includes("(hook ")) ? handleClearHook : handleAddHook}
              disabled={hookLoading}
            >
              {hookLoading
                ? "Hook..."
                : timelineItems.some(i => i.label?.includes("(hook "))
                  ? "× Hook"
                  : "+ Hook"}
            </button>
          )}
        </div>
      </div>
      {rows[0]?.actions.length === 0 ? (
        <p className="timeline-empty">Timeline is empty. Process some clips to get started.</p>
      ) : (
        <>
        <div className="timeline-with-sidebar">
          <div className="track-sidebar">
            <div className="track-sidebar-ruler" />
            {trackLabels.map((track) => (
              <div key={track.id} className="track-sidebar-cell">
                {track.track === "analyze" ? (
                  <>
                    <button
                      className={`track-sidebar-btn ${track.loading ? "loading" : ""}${track.loading && track.onCancel ? " cancellable" : ""}`}
                      data-track={track.hasItems || track.loading ? track.track : undefined}
                      onClick={track.loading && track.onCancel ? track.onCancel : track.onAdd}
                      disabled={track.loading && !track.onCancel || timelineItems.length === 0}
                      title={track.loading && track.onCancel ? `Cancel ${track.label}` : `Analyze b-roll`}
                    >
                      {track.loading ? (track.onCancel ? `Cancel` : track.label) : `+ ${track.label}`}
                    </button>
                    {track.hasItems && !track.loading && (
                      <button
                        className="track-sidebar-btn-clear"
                        onClick={track.onClear}
                        title={`Clear ${track.label}`}
                      >
                        ×
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    className={`track-sidebar-btn ${track.loading ? "loading" : ""}`}
                    data-track={track.hasItems || track.loading ? track.track : undefined}
                    onClick={track.loading && track.onCancel ? track.onCancel : track.hasItems ? track.onClear : track.onAdd}
                    disabled={track.loading && !track.onCancel || timelineItems.length === 0}
                    title={track.loading && track.onCancel ? `Cancel ${track.label}` : track.hasItems ? `Clear ${track.label}` : `Add ${track.label}`}
                  >
                    {track.loading ? (track.onCancel ? `Cancel` : track.label) : track.hasItems ? `\u00d7 ${track.label}` : `+ ${track.label}`}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="timeline-editor-wrapper" ref={wrapperRef}>
            <TimelineEditor
            ref={timelineRef}
            editorData={rows}
            effects={effects}
            scale={SCALE}
            scaleWidth={scaleWidth}
            rowHeight={50}
            style={{ height: 52 + rows.length * 50 }}
            hideCursor={false}
            autoScroll={true}
            autoReRender={false}
            onCursorDrag={handleCursorDrag}
            onClickTimeArea={handleClickTimeArea}
            getActionRender={(action) => {
              if (action.effectId === "title") {
                const t = action as unknown as TitleAction;
                if (editingTitleId === t.titleId) {
                  return (
                    <div className="tl-action-render title editing">
                      <input
                        className="title-edit-input"
                        autoFocus
                        value={editingTitleText}
                        onChange={(e) => setEditingTitleText(e.target.value)}
                        onBlur={() => handleSaveTitle(t.titleId, editingTitleText)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveTitle(t.titleId, editingTitleText);
                          if (e.key === "Escape") setEditingTitleId(null);
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    className="tl-action-render title"
                    title="Double-click to edit"
                    onDoubleClick={() => {
                      setEditingTitleId(t.titleId);
                      setEditingTitleText(t.titleText);
                    }}
                  >
                    <span className="tl-action-label">{t.titleText}</span>
                  </div>
                );
              }
              if (action.effectId === "caption") {
                const c = action as unknown as CaptionAction;
                if (editingCaptionId === c.captionId) {
                  return (
                    <div className="tl-action-render caption editing">
                      <input
                        className="caption-edit-input"
                        autoFocus
                        value={editingCaptionText}
                        onChange={(e) => setEditingCaptionText(e.target.value)}
                        onBlur={() => handleSaveCaption(c.captionId, editingCaptionText)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveCaption(c.captionId, editingCaptionText);
                          if (e.key === "Escape") setEditingCaptionId(null);
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    className="tl-action-render caption"
                    title="Double-click to edit"
                    onDoubleClick={() => {
                      setEditingCaptionId(c.captionId);
                      setEditingCaptionText(c.captionText);
                    }}
                  >
                    <span className="tl-action-label">{c.captionText}</span>
                  </div>
                );
              }
              if (action.effectId === "timestamp") {
                const ts = action as unknown as TimestampAction;
                if (editingTimestampId === ts.timestampId) {
                  return (
                    <div className="tl-action-render timestamp editing">
                      <input
                        className="timestamp-edit-input"
                        autoFocus
                        value={editingTimestampText}
                        onChange={(e) => setEditingTimestampText(e.target.value)}
                        onBlur={() => handleSaveTimestamp(ts.timestampId, editingTimestampText)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveTimestamp(ts.timestampId, editingTimestampText);
                          if (e.key === "Escape") setEditingTimestampId(null);
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    className="tl-action-render timestamp"
                    title="Double-click to edit"
                    onDoubleClick={() => {
                      setEditingTimestampId(ts.timestampId);
                      setEditingTimestampText(ts.timestampText);
                    }}
                  >
                    <span className="tl-action-label">{ts.timestampText}</span>
                  </div>
                );
              }
              if (action.effectId === "subscribe") {
                return (
                  <div className="tl-action-render subscribe" title="Subscribe overlay">
                    <span className="tl-action-label">Subscribe</span>
                    <span className="tl-action-dur">
                      {(action.end - action.start).toFixed(1)}s
                    </span>
                  </div>
                );
              }
              if (action.effectId === "tracker") {
                return (
                  <div className="tl-action-render tracker" title="Tracker overlay">
                    <span className="tl-action-label">Tracker</span>
                    <span className="tl-action-dur">
                      {(action.end - action.start).toFixed(1)}s
                    </span>
                  </div>
                );
              }
              if (action.effectId === "zoom") {
                return (
                  <div className="tl-action-render zoom" title="Slow Zoom">
                    <span className="tl-action-label">Zoom</span>
                    <span className="tl-action-dur">
                      {(action.end - action.start).toFixed(1)}s
                    </span>
                  </div>
                );
              }
              if (action.effectId === "enlarge") {
                return (
                  <div className="tl-action-render enlarge" title="Enlarge 5%">
                    <span className="tl-action-label">Enlarge</span>
                    <span className="tl-action-dur">
                      {(action.end - action.start).toFixed(1)}s
                    </span>
                  </div>
                );
              }
              if (action.effectId === "analyze") {
                const az = action as unknown as AnalyzeAction;
                return (
                  <div
                    className={`tl-action-render analyze ${selectedAnalyzeId === az.analyzeId ? "selected" : ""}`}
                    onClick={(e) => {
                      if (selectedAnalyzeId === az.analyzeId) {
                        setSelectedAnalyzeId(null);
                        setSelectedAnalyzeText("");
                        setAnalyzePopupPos(null);
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setSelectedAnalyzeId(az.analyzeId);
                        setSelectedAnalyzeText(az.analyzeText);
                        setAnalyzePopupPos({ x: rect.left, y: rect.top });
                      }
                    }}
                  >
                    <span className="tl-action-label">{az.analyzeText}</span>
                  </div>
                );
              }
              if (action.effectId === "music") {
                const m = action as MusicAction;
                return (
                  <div className="tl-action-render music" title={m.assetName}>
                    <span className="tl-action-label">{m.assetName}</span>
                    <span className="tl-action-dur">
                      {(m.end - m.start).toFixed(1)}s
                    </span>
                  </div>
                );
              }
              const a = action as VideoAction;
              const clipClass = a.clipType === "broll" ? "broll" : a.clipType === "remix" ? "remix" : "talking";
              return (
                <div
                  className={`tl-action-render ${clipClass}`}
                  title={a.label}
                >
                  <span className="tl-action-label">{a.label}</span>
                  <span className="tl-action-dur">
                    {(a.end - a.start).toFixed(1)}s
                  </span>
                </div>
              );
            }}
            onChange={(editorData) => {
              for (const row of editorData) {
                for (const action of row.actions) {
                  if (action.effectId === "subscribe") {
                    const sa = action as unknown as SubscribeAction;
                    updateSubscribeItem(sa.subscribeId, {
                      start_time: action.start,
                      end_time: action.end,
                    });
                  }
                }
              }
            }}
          />
          </div>
        </div>
        </>
      )}
      {analyzePopupPos && selectedAnalyzeText && createPortal(
        <>
          <div className="analyze-popup-backdrop" onClick={() => { setSelectedAnalyzeId(null); setSelectedAnalyzeText(""); setAnalyzePopupPos(null); }} />
          <div className="analyze-popup" style={{ left: analyzePopupPos.x, top: analyzePopupPos.y }}>
            {selectedAnalyzeText}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
