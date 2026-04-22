import { create } from "zustand";
import type { RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import type { Project, Clip, TimelineItem, Asset, MusicItem, TitleItem, CaptionItem, TimestampItem, TrackerItem, SubscribeItem, ZoomItem, EnlargeItem, AnalyzeItem, VolumeKeypoint } from "../types";

interface TimelineStore {
  project: Project | null;
  clips: Clip[];
  timelineItems: TimelineItem[];
  isWatching: boolean;
  renderProgress: number | null;
  renderStage: string | null;
  playerRef: RefObject<PlayerRef | null> | null;
  scanningFiles: boolean;
  scanProgress: { current: number; total: number; filename?: string } | null;

  setProject: (p: Project | null) => void;
  setClips: (clips: Clip[]) => void;
  setScanningFiles: (s: boolean) => void;
  setScanProgress: (p: { current: number; total: number; filename?: string } | null) => void;
  addClip: (clip: Clip) => void;
  updateClipStatus: (clipId: number, status: Clip["status"], progress?: number | null, detail?: string | null) => void;
  updateClip: (clip: Partial<Clip> & { id: number }) => void;
  setTimelineItems: (items: TimelineItem[]) => void;
  setIsWatching: (w: boolean) => void;
  setRenderProgress: (pct: number | null, stage?: string | null) => void;
  setPlayerRef: (ref: RefObject<PlayerRef | null> | null) => void;

  selectedTitle: string | null;
  setSelectedTitle: (title: string | null) => void;

  // Video metadata (shared with YouTube upload)
  videoDescription: string;
  videoTags: string[];
  videoCategory: string;
  videoVisibility: string;
  selectedThumbnailIndices: number[];
  descSystemPrompt: string;
  setVideoDescription: (d: string) => void;
  setVideoTags: (t: string[]) => void;
  setVideoCategory: (c: string) => void;
  setVideoVisibility: (v: string) => void;
  setSelectedThumbnailIndices: (indices: number[]) => void;
  setDescSystemPrompt: (p: string) => void;
  thumbnailUrls: string[];
  thumbnailText: string;
  setThumbnailUrls: (urls: string[]) => void;
  setThumbnailText: (text: string) => void;

  // Asset library
  assets: Asset[];
  setAssets: (assets: Asset[]) => void;

  // Music track
  musicItems: MusicItem[];
  volumeEnvelope: VolumeKeypoint[];
  musicLoading: boolean;
  setMusicItems: (items: MusicItem[]) => void;
  setVolumeEnvelope: (envelope: VolumeKeypoint[]) => void;
  setMusicLoading: (loading: boolean) => void;

  // Title overlays
  titleItems: TitleItem[];
  titleLoading: boolean;
  setTitleItems: (items: TitleItem[]) => void;
  setTitleLoading: (loading: boolean) => void;
  updateTitleItem: (id: number, updates: Partial<TitleItem>) => void;

  // Caption overlays
  captionItems: CaptionItem[];
  captionLoading: boolean;
  setCaptionItems: (items: CaptionItem[]) => void;
  setCaptionLoading: (loading: boolean) => void;
  updateCaptionItem: (id: number, updates: Partial<CaptionItem>) => void;

  // Timestamp overlays
  timestampItems: TimestampItem[];
  timestampLoading: boolean;
  setTimestampItems: (items: TimestampItem[]) => void;
  setTimestampLoading: (loading: boolean) => void;
  updateTimestampItem: (id: number, updates: Partial<TimestampItem>) => void;

  // Tracker overlays
  trackerItems: TrackerItem[];
  trackerLoading: boolean;
  setTrackerItems: (items: TrackerItem[]) => void;
  setTrackerLoading: (loading: boolean) => void;

  // Subscribe overlays
  subscribeItems: SubscribeItem[];
  subscribeLoading: boolean;
  setSubscribeItems: (items: SubscribeItem[]) => void;
  setSubscribeLoading: (loading: boolean) => void;
  updateSubscribeItem: (id: number, updates: Partial<SubscribeItem>) => void;

  // Zoom adjustment items
  zoomItems: ZoomItem[];
  zoomLoading: boolean;
  setZoomItems: (items: ZoomItem[]) => void;
  setZoomLoading: (loading: boolean) => void;

  // Enlarge adjustment items
  enlargeItems: EnlargeItem[];
  enlargeLoading: boolean;
  setEnlargeItems: (items: EnlargeItem[]) => void;
  setEnlargeLoading: (loading: boolean) => void;

  // Analyze descriptions
  analyzeItems: AnalyzeItem[];
  analyzeLoading: boolean;
  setAnalyzeItems: (items: AnalyzeItem[]) => void;
  setAnalyzeLoading: (loading: boolean) => void;
  addAnalyzeItem: (item: AnalyzeItem) => void;

  // Remix clips
  remixLoading: boolean;
  setRemixLoading: (loading: boolean) => void;

  // Hook highlights
  hookLoading: boolean;
  setHookLoading: (loading: boolean) => void;

  // Auto-save status
  saveStatus: "idle" | "saving" | "saved";
  setSaveStatus: (s: "idle" | "saving" | "saved") => void;

  // YouTube upload
  youtubeAuth: { authenticated: boolean; channelName: string | null };
  youtubeUploadProgress: number | null;
  youtubeUploadResult: { videoId: string; videoUrl: string } | null;
  youtubeUploadError: string | null;
  setYoutubeAuth: (auth: { authenticated: boolean; channelName: string | null }) => void;
  setYoutubeUploadProgress: (pct: number | null) => void;
  setYoutubeUploadResult: (r: { videoId: string; videoUrl: string } | null) => void;
  setYoutubeUploadError: (err: string | null) => void;
}

export const useTimelineStore = create<TimelineStore>((set) => ({
  project: null,
  clips: [],
  timelineItems: [],
  isWatching: false,
  renderProgress: null,
  renderStage: null,
  playerRef: null,
  scanningFiles: false,
  scanProgress: null,

  setProject: (project) => set({ project }),
  setClips: (clips) => set({ clips }),
  setScanningFiles: (scanningFiles) => set({ scanningFiles }),
  setScanProgress: (scanProgress) => set({ scanProgress }),

  addClip: (clip) =>
    set((state) => ({
      clips: [...state.clips, clip],
    })),

  updateClipStatus: (clipId, status, progress, detail) =>
    set((state) => ({
      clips: state.clips.map((c) =>
        c.id === clipId
          ? { ...c, status, progress: progress ?? c.progress, progressDetail: detail ?? c.progressDetail }
          : c
      ),
    })),

  updateClip: (partial) =>
    set((state) => ({
      clips: state.clips.map((c) =>
        c.id === partial.id ? { ...c, ...partial } : c
      ),
    })),

  setTimelineItems: (items) => set({ timelineItems: items }),
  setIsWatching: (isWatching) => set({ isWatching }),
  setRenderProgress: (pct, stage) =>
    set({ renderProgress: pct, renderStage: stage ?? null }),
  setPlayerRef: (playerRef) => set({ playerRef }),

  selectedTitle: null,
  setSelectedTitle: (selectedTitle) => set({ selectedTitle }),

  videoDescription: "",
  videoTags: [],
  videoCategory: "22",
  videoVisibility: "private",
  selectedThumbnailIndices: [],
  descSystemPrompt: "",
  setVideoDescription: (videoDescription) => set({ videoDescription }),
  setVideoTags: (videoTags) => set({ videoTags }),
  setVideoCategory: (videoCategory) => set({ videoCategory }),
  setVideoVisibility: (videoVisibility) => set({ videoVisibility }),
  setSelectedThumbnailIndices: (selectedThumbnailIndices) => set({ selectedThumbnailIndices }),
  setDescSystemPrompt: (descSystemPrompt) => set({ descSystemPrompt }),
  thumbnailUrls: [],
  thumbnailText: "",
  setThumbnailUrls: (thumbnailUrls) => set({ thumbnailUrls }),
  setThumbnailText: (thumbnailText) => set({ thumbnailText }),

  assets: [],
  setAssets: (assets) => set({ assets }),

  musicItems: [],
  volumeEnvelope: [],
  musicLoading: false,
  setMusicItems: (musicItems) => set({ musicItems }),
  setVolumeEnvelope: (volumeEnvelope) => set({ volumeEnvelope }),
  setMusicLoading: (musicLoading) => set({ musicLoading }),

  titleItems: [],
  titleLoading: false,
  setTitleItems: (titleItems) => set({ titleItems }),
  setTitleLoading: (titleLoading) => set({ titleLoading }),
  updateTitleItem: (id, updates) =>
    set((state) => ({
      titleItems: state.titleItems.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    })),

  captionItems: [],
  captionLoading: false,
  setCaptionItems: (captionItems) => set({ captionItems }),
  setCaptionLoading: (captionLoading) => set({ captionLoading }),
  updateCaptionItem: (id, updates) =>
    set((state) => ({
      captionItems: state.captionItems.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    })),

  timestampItems: [],
  timestampLoading: false,
  setTimestampItems: (timestampItems) => set({ timestampItems }),
  setTimestampLoading: (timestampLoading) => set({ timestampLoading }),
  updateTimestampItem: (id, updates) =>
    set((state) => ({
      timestampItems: state.timestampItems.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    })),

  trackerItems: [],
  trackerLoading: false,
  setTrackerItems: (trackerItems) => set({ trackerItems }),
  setTrackerLoading: (trackerLoading) => set({ trackerLoading }),

  subscribeItems: [],
  subscribeLoading: false,
  setSubscribeItems: (subscribeItems) => set({ subscribeItems }),
  setSubscribeLoading: (subscribeLoading) => set({ subscribeLoading }),
  updateSubscribeItem: (id, updates) =>
    set((state) => ({
      subscribeItems: state.subscribeItems.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    })),

  zoomItems: [],
  zoomLoading: false,
  setZoomItems: (zoomItems) => set({ zoomItems }),
  setZoomLoading: (zoomLoading) => set({ zoomLoading }),

  enlargeItems: [],
  enlargeLoading: false,
  setEnlargeItems: (enlargeItems) => set({ enlargeItems }),
  setEnlargeLoading: (enlargeLoading) => set({ enlargeLoading }),

  analyzeItems: [],
  analyzeLoading: false,
  setAnalyzeItems: (analyzeItems) => set({ analyzeItems }),
  setAnalyzeLoading: (analyzeLoading) => set({ analyzeLoading }),
  addAnalyzeItem: (item) =>
    set((state) => {
      const idx = state.analyzeItems.findIndex((a) => a.id === item.id);
      if (idx >= 0) {
        const updated = [...state.analyzeItems];
        updated[idx] = item;
        return { analyzeItems: updated };
      }
      return { analyzeItems: [...state.analyzeItems, item] };
    }),

  remixLoading: false,
  setRemixLoading: (remixLoading) => set({ remixLoading }),

  hookLoading: false,
  setHookLoading: (hookLoading) => set({ hookLoading }),

  saveStatus: "idle" as const,
  setSaveStatus: (saveStatus) => set({ saveStatus }),

  youtubeAuth: { authenticated: false, channelName: null },
  youtubeUploadProgress: null,
  youtubeUploadResult: null,
  youtubeUploadError: null,
  setYoutubeAuth: (youtubeAuth) => set({ youtubeAuth }),
  setYoutubeUploadProgress: (youtubeUploadProgress) => set({ youtubeUploadProgress }),
  setYoutubeUploadResult: (youtubeUploadResult) => set({ youtubeUploadResult }),
  setYoutubeUploadError: (youtubeUploadError) => set({ youtubeUploadError }),
}));
