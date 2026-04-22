export interface Project {
  id: number;
  name: string;
  watch_directory: string;
  clips: Clip[];
  selected_title: string | null;
  video_description: string | null;
  video_tags: string | null; // JSON string
  video_category: string | null;
  video_visibility: string | null;
  selected_thumbnail_idx: number | null;
  desc_system_prompt: string | null;
  thumbnail_urls: string | null;
  locked_thumbnail_indices: string | null;
  thumbnail_text: string | null;
  render_path: string | null;
}

export interface SubClip {
  id: number;
  start_time: number;
  end_time: number;
  score: number | null;
  label: string | null;
}

export interface Clip {
  id: number;
  source_path: string;
  processed_path: string | null;
  clip_type: "talking" | "broll" | "remix" | null;
  status: "pending" | "transcribing" | "classifying" | "processing" | "done" | "error";
  duration: number | null;
  transcript: string | null;
  error_message: string | null;
  sub_clips: SubClip[];
  progress?: number | null;
  progressDetail?: string | null;
}

export interface TimelineItem {
  id: number;
  clip_id: number | null;
  sub_clip_id: number | null;
  position: number;
  video_url: string;
  duration: number;
  start_time: number;
  end_time: number;
  label: string;
  clip_type: string | null;
}

export interface Asset {
  id: number;
  name: string;
  file_path: string;
  asset_type: "music" | "sfx";
  duration: number;
}

export interface MusicItem {
  id: number;
  asset_id: number;
  asset_name: string;
  file_path?: string;
  start_time: number;
  end_time: number;
  volume: number;
}

export interface TitleItem {
  id: number
  text: string
  start_time: number
  end_time: number
}

export interface CaptionItem {
  id: number
  text: string
  start_time: number
  end_time: number
}

export interface TimestampItem {
  id: number
  text: string
  start_time: number
  end_time: number
}

export interface TrackerItem {
  id: number
  start_time: number
  end_time: number
  overlay_url: string
}

export interface SubscribeItem {
  id: number
  text: string
  start_time: number
  end_time: number
}

export interface ZoomItem {
  id: number
  start_time: number
  end_time: number
}

export interface EnlargeItem {
  id: number
  start_time: number
  end_time: number
}

export interface AnalyzeItem {
  id: number
  clip_id: number | null
  sub_clip_id: number | null
  text: string
  start_time: number
  end_time: number
}

export interface VolumeKeypoint {
  t: number;
  v: number;
}

export interface WsMessage {
  event: string;
  data: Record<string, unknown>;
}

export interface TitleSuggestionsResponse {
  titles: string[];
}
