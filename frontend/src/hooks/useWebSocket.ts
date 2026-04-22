import { useEffect, useRef } from "react";
import { useTimelineStore } from "../stores/timelineStore";
import type { WsMessage } from "../types";

export function useWebSocket(projectId: number | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const store = useTimelineStore();

  useEffect(() => {
    if (!projectId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${projectId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);

      switch (msg.event) {
        case "clip_detected":
          store.addClip({
            id: msg.data.clip_id as number,
            source_path: (msg.data.filename as string) || "",
            processed_path: null,
            clip_type: null,
            status: "pending",
            duration: null,
            transcript: null,
            error_message: null,
            sub_clips: [],
          });
          break;

        case "clip_status":
          store.updateClipStatus(
            msg.data.clip_id as number,
            msg.data.status as "pending" | "transcribing" | "classifying" | "processing" | "done" | "error"
          );
          break;

        case "clip_progress":
          store.updateClipStatus(
            msg.data.clip_id as number,
            msg.data.status as "pending" | "transcribing" | "classifying" | "processing" | "done" | "error",
            msg.data.progress as number,
            msg.data.detail as string,
          );
          break;

        case "clip_done":
        case "clip_error":
          // Refresh clips and timeline from server
          refreshData(projectId);
          break;

        case "timeline_updated":
          refreshTimeline(projectId);
          break;

        case "scan_progress":
          if (msg.data.stage === "done") {
            store.setScanProgress(null);
            store.setScanningFiles(false);
          } else {
            store.setScanningFiles(true);
            store.setScanProgress({
              current: msg.data.current as number,
              total: msg.data.total as number,
              filename: msg.data.filename as string | undefined,
            });
          }
          break;

        case "render_progress":
          store.setRenderProgress(
            msg.data.percent as number,
            msg.data.stage as string
          );
          break;

        case "render_done":
          store.setRenderProgress(100, "done");
          break;

        case "youtube_upload_progress":
          store.setYoutubeUploadProgress(msg.data.percent as number);
          break;

        case "youtube_upload_done":
          store.setYoutubeUploadProgress(100);
          store.setYoutubeUploadResult({
            videoId: msg.data.video_id as string,
            videoUrl: msg.data.video_url as string,
          });
          break;

        case "youtube_upload_error":
          store.setYoutubeUploadProgress(null);
          store.setYoutubeUploadError(msg.data.error as string);
          break;

        case "analyze_item_done":
          store.addAnalyzeItem({
            id: msg.data.id as number,
            clip_id: (msg.data.clip_id as number | null) ?? null,
            sub_clip_id: (msg.data.sub_clip_id as number | null) ?? null,
            text: msg.data.text as string,
            start_time: msg.data.start_time as number,
            end_time: msg.data.end_time as number,
          });
          break;

        case "analyze_done":
          store.setAnalyzeLoading(false);
          break;
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [projectId]);
}

async function refreshData(projectId: number) {
  const store = useTimelineStore.getState();
  try {
    const [clipsRes, timelineRes] = await Promise.all([
      fetch(`/api/clips?project_id=${projectId}`),
      fetch(`/api/timeline/${projectId}`),
    ]);
    if (clipsRes.ok) store.setClips(await clipsRes.json());
    if (timelineRes.ok) store.setTimelineItems(await timelineRes.json());
  } catch {}
}

async function refreshTimeline(projectId: number) {
  const store = useTimelineStore.getState();
  try {
    const res = await fetch(`/api/timeline/${projectId}`);
    if (res.ok) store.setTimelineItems(await res.json());
  } catch {}
}
