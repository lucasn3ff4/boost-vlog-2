import type { TimelineRow, TimelineAction } from "@xzdarcy/react-timeline-editor";
import type { TimelineItem, MusicItem, TitleItem, CaptionItem, TimestampItem, TrackerItem, SubscribeItem, ZoomItem, EnlargeItem, AnalyzeItem, VolumeKeypoint } from "../types";

export const FPS = 30;

export function secondsToFrames(seconds: number): number {
  return Math.round(seconds * FPS);
}

export function framesToSeconds(frames: number): number {
  return frames / FPS;
}

export interface VideoAction extends TimelineAction {
  videoUrl: string;
  sourceStart: number;
  sourceEnd: number;
  label: string;
  clipType: string | null;
}

export interface MusicAction extends TimelineAction {
  assetName: string;
}

export interface TitleAction extends TimelineAction {
  titleText: string;
  titleId: number;
}

export interface CaptionAction extends TimelineAction {
  captionText: string;
  captionId: number;
}

export interface TimestampAction extends TimelineAction {
  timestampText: string;
  timestampId: number;
}

export interface TrackerAction extends TimelineAction {
  trackerId: number;
  overlayUrl: string;
}

export interface SubscribeAction extends TimelineAction {
  subscribeText: string;
  subscribeId: number;
}

export interface ZoomAction extends TimelineAction {
  zoomId: number;
}

export interface EnlargeAction extends TimelineAction {
  enlargeId: number;
}

export interface AnalyzeAction extends TimelineAction {
  analyzeText: string;
  analyzeId: number;
}

/**
 * Convert backend TimelineItem[] and MusicItem[] into react-timeline-editor format.
 * Produces a video track and optionally a music track.
 */
export function toEditorData(items: TimelineItem[], musicItems?: MusicItem[], titleItems?: TitleItem[], captionItems?: CaptionItem[], timestampItems?: TimestampItem[], trackerItems?: TrackerItem[], subscribeItems?: SubscribeItem[], zoomItems?: ZoomItem[], enlargeItems?: EnlargeItem[], analyzeItems?: AnalyzeItem[]): {
  rows: TimelineRow[];
  actions: VideoAction[];
  totalDuration: number;
} {
  let cursor = 0;
  const actions: VideoAction[] = [];

  for (const item of items) {
    if (item.duration < 0.034) continue; // skip sub-frame clips
    const action: VideoAction = {
      id: String(item.id),
      start: cursor,
      end: cursor + item.duration,
      effectId: "video",
      videoUrl: item.video_url,
      sourceStart: item.start_time,
      sourceEnd: item.end_time,
      label: item.label,
      clipType: item.clip_type,
    };
    actions.push(action);
    cursor += item.duration;
  }

  const musicActions: MusicAction[] = (musicItems || []).map((mi) => ({
    id: `music-${mi.id}`,
    start: mi.start_time,
    end: mi.end_time,
    effectId: "music",
    assetName: mi.asset_name,
  }));

  const titleActions: TitleAction[] = (titleItems || []).map((ti) => ({
    id: `title-${ti.id}`,
    start: ti.start_time,
    end: ti.end_time,
    effectId: "title",
    titleText: ti.text,
    titleId: ti.id,
  }));

  const captionActions: CaptionAction[] = (captionItems || []).map((ci) => ({
    id: `caption-${ci.id}`,
    start: ci.start_time,
    end: ci.end_time,
    effectId: "caption",
    captionText: ci.text,
    captionId: ci.id,
  }));

  const timestampActions: TimestampAction[] = (timestampItems || []).map((ts) => ({
    id: `timestamp-${ts.id}`,
    start: ts.start_time,
    end: ts.end_time,
    effectId: "timestamp",
    timestampText: ts.text,
    timestampId: ts.id,
  }));

  const trackerActions: TrackerAction[] = (trackerItems || []).map((ti) => ({
    id: `tracker-${ti.id}`,
    start: ti.start_time,
    end: ti.end_time,
    effectId: "tracker",
    trackerId: ti.id,
    overlayUrl: ti.overlay_url,
  }));

  const subscribeActions: SubscribeAction[] = (subscribeItems || []).map((si) => ({
    id: `subscribe-${si.id}`,
    start: si.start_time,
    end: si.end_time,
    effectId: "subscribe",
    subscribeText: si.text,
    subscribeId: si.id,
  }));

  const zoomActions: ZoomAction[] = (zoomItems || []).map((zi) => ({
    id: `zoom-${zi.id}`,
    start: zi.start_time,
    end: zi.end_time,
    effectId: "zoom",
    zoomId: zi.id,
  }));

  const enlargeActions: EnlargeAction[] = (enlargeItems || []).map((ei) => ({
    id: `enlarge-${ei.id}`,
    start: ei.start_time,
    end: ei.end_time,
    effectId: "enlarge",
    enlargeId: ei.id,
  }));

  const analyzeActions: AnalyzeAction[] = (analyzeItems || []).map((ai) => ({
    id: `analyze-${ai.id}`,
    start: ai.start_time,
    end: ai.end_time,
    effectId: "analyze",
    analyzeText: ai.text,
    analyzeId: ai.id,
  }));

  const rows: TimelineRow[] = [
    { id: "video-track", actions },
    { id: "analyze-track", actions: analyzeActions },
    { id: "music-track", actions: musicActions },
    { id: "title-track", actions: titleActions },
    { id: "caption-track", actions: captionActions },
    { id: "timestamp-track", actions: timestampActions },
    { id: "tracker-track", actions: trackerActions },
    { id: "subscribe-track", actions: subscribeActions },
    { id: "zoom-track", actions: zoomActions },
    { id: "enlarge-track", actions: enlargeActions },
  ];

  return { rows, actions, totalDuration: cursor };
}

/**
 * Compute total duration in frames for the Remotion Player.
 */
export function totalDurationInFrames(items: TimelineItem[]): number {
  let total = 0;
  for (const item of items) {
    if (item.duration < 0.034) continue;
    total += Math.max(secondsToFrames(item.duration), 1);
  }
  return total;
}

/**
 * Given a timeline time in seconds, find which action it falls in
 * and compute the Remotion frame number for the composition.
 */
export function timelineSecondsToFrame(seconds: number, items: TimelineItem[]): number {
  let cursor = 0;
  let frameCursor = 0;
  for (const item of items) {
    if (item.duration < 0.034) continue;
    const dur = item.duration;
    const frames = Math.max(secondsToFrames(dur), 1);
    if (seconds < cursor + dur) {
      const offset = seconds - cursor;
      return frameCursor + Math.round(offset * FPS);
    }
    cursor += dur;
    frameCursor += frames;
  }
  return frameCursor;
}

/**
 * Given a Remotion frame number, compute the timeline time in seconds.
 */
export function frameToTimelineSeconds(frame: number, items: TimelineItem[]): number {
  let cursor = 0;
  let frameCursor = 0;
  for (const item of items) {
    if (item.duration < 0.034) continue;
    const dur = item.duration;
    const frames = Math.max(secondsToFrames(dur), 1);
    if (frame < frameCursor + frames) {
      const offsetFrames = frame - frameCursor;
      return cursor + offsetFrames / FPS;
    }
    cursor += dur;
    frameCursor += frames;
  }
  return cursor;
}

export interface FrameLayoutEntry {
  item: TimelineItem;
  startFrame: number;
  durationInFrames: number;
}

export function computeFrameLayout(items: TimelineItem[]): FrameLayoutEntry[] {
  let currentFrame = 0;
  return items
    .filter((item) => item.duration >= 0.034)
    .map((item) => {
      const durationInFrames = Math.max(secondsToFrames(item.duration), 1);
      const entry: FrameLayoutEntry = {
        item,
        startFrame: currentFrame,
        durationInFrames,
      };
      currentFrame += durationInFrames;
      return entry;
    });
}

/**
 * Linear interpolation over a pre-computed volume envelope.
 * The envelope is a list of {t, v} keypoints sorted by time.
 */
export function interpolateEnvelope(
  envelope: VolumeKeypoint[],
  timeSeconds: number,
): number {
  if (envelope.length === 0) return 0.25;
  if (timeSeconds <= envelope[0].t) return envelope[0].v;
  if (timeSeconds >= envelope[envelope.length - 1].t)
    return envelope[envelope.length - 1].v;

  for (let i = 0; i < envelope.length - 1; i++) {
    const a = envelope[i];
    const b = envelope[i + 1];
    if (timeSeconds >= a.t && timeSeconds <= b.t) {
      if (b.t === a.t) return a.v;
      const ratio = (timeSeconds - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * ratio;
    }
  }
  return envelope[envelope.length - 1].v;
}
