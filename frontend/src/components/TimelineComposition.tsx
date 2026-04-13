import React, { useCallback, useMemo } from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { secondsToFrames, interpolateEnvelope, FPS } from "../lib/remotion";
import { useTimelineStore } from "../stores/timelineStore";
import type { TimelineItem, MusicItem, TitleItem, CaptionItem, TimestampItem, TrackerItem, SubscribeItem, ZoomItem, EnlargeItem, VolumeKeypoint } from "../types";

const PREMOUNT_FRAMES = 30;
const BROLL_AUDIO_VOLUME = 0.15;
const REMIX_AUDIO_VOLUME = 0.9;

export interface Props {
  items: TimelineItem[];
  musicItems?: MusicItem[];
  volumeEnvelope?: VolumeKeypoint[];
  titleItems?: TitleItem[];
  captionItems?: CaptionItem[];
  timestampItems?: TimestampItem[];
  trackerItems?: TrackerItem[];
  subscribeItems?: SubscribeItem[];
  zoomItems?: ZoomItem[];
  enlargeItems?: EnlargeItem[];
  /** Base URL prefix for API paths during server-side render (e.g. "http://localhost:8000") */
  baseUrl?: string;
  /** Local file paths for SFX (server-side render only) */
  sfxTitleInPath?: string;
  sfxTitleOutPath?: string;
}

interface ClipLayout {
  item: TimelineItem;
  startFrame: number;
  durationInFrames: number;
}

export const TimelineComposition: React.FC<Props> = React.memo(({
  items,
  musicItems: propMusic,
  volumeEnvelope: propEnvelope,
  titleItems: propTitles,
  captionItems: propCaptions,
  timestampItems: propTimestamps,
  trackerItems: propTrackers,
  subscribeItems: propSubscribes,
  zoomItems: propZooms,
  enlargeItems: propEnlarges,
  baseUrl = "",
  sfxTitleInPath,
  sfxTitleOutPath,
}) => {
  const frame = useCurrentFrame();

  const storeMusic = useTimelineStore((s) => s.musicItems);
  const musicItems = propMusic ?? storeMusic;
  const hasMusic = musicItems.length > 0;

  const storeZooms = useTimelineStore((s) => s.zoomItems);
  const zoomItems = propZooms ?? storeZooms;
  const storeEnlarges = useTimelineStore((s) => s.enlargeItems);
  const enlargeItems = propEnlarges ?? storeEnlarges;

  const layout = useMemo(() => {
    let cursor = 0;
    const result: ClipLayout[] = [];
    for (const item of items) {
      if (item.duration < 0.034) continue;
      const dur = Math.max(secondsToFrames(item.duration), 1);
      result.push({ item, startFrame: cursor, durationInFrames: dur });
      cursor += dur;
    }
    return result;
  }, [items]);

  let activeIdx = -1;
  for (let i = 0; i < layout.length; i++) {
    const clip = layout[i];
    if (frame >= clip.startFrame && frame < clip.startFrame + clip.durationInFrames) {
      activeIdx = i;
      break;
    }
  }
  if (activeIdx === -1 && layout.length > 0) {
    activeIdx = layout.length - 1;
  }

  const toMount = [activeIdx - 1, activeIdx, activeIdx + 1].filter(
    (i) => i >= 0 && i < layout.length
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <MusicLayer musicItems={propMusic} volumeEnvelope={propEnvelope} baseUrl={baseUrl} />
      {toMount.map((i) => {
        const clip = layout[i];

        return (
          <Sequence
            key={`${clip.item.id}-${clip.item.position}`}
            from={clip.startFrame}
            durationInFrames={clip.durationInFrames}
            premountFor={PREMOUNT_FRAMES}
          >
            <VideoClipWithEffects
              clip={clip}
              baseUrl={baseUrl}
              hasMusic={hasMusic}
              zoomItems={zoomItems}
              enlargeItems={enlargeItems}
            />
          </Sequence>
        );
      })}
      <TitleLayer titleItems={propTitles} baseUrl={baseUrl} sfxTitleInPath={sfxTitleInPath} sfxTitleOutPath={sfxTitleOutPath} />
      <CaptionLayer captionItems={propCaptions} />
      <TimestampLayer timestampItems={propTimestamps} />
      <TrackerLayer trackerItems={propTrackers} baseUrl={baseUrl} />
      <SubscribeLayer subscribeItems={propSubscribes} />
    </AbsoluteFill>
  );
});

const VideoClipWithEffects: React.FC<{
  clip: ClipLayout;
  baseUrl: string;
  hasMusic: boolean;
  zoomItems: ZoomItem[];
  enlargeItems: EnlargeItem[];
}> = ({ clip, baseUrl, hasMusic, zoomItems, enlargeItems }) => {
  const videoStartFrame = secondsToFrames(clip.item.start_time);

  const clipTimelineStart = clip.startFrame / FPS;
  const clipTimelineEnd = clipTimelineStart + clip.durationInFrames / FPS;

  // Check for enlarge effect (static 5% scale-up)
  let isEnlarged = false;
  for (const ei of enlargeItems) {
    if (ei.end_time > clipTimelineStart && ei.start_time < clipTimelineEnd) {
      isEnlarged = true;
      break;
    }
  }

  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={`${baseUrl}${clip.item.video_url}`}
        startFrom={videoStartFrame}
        endAt={videoStartFrame + clip.durationInFrames}
        pauseWhenBuffering
        delayRenderTimeoutInMilliseconds={240000}
        volume={hasMusic && clip.item.clip_type === "broll" ? BROLL_AUDIO_VOLUME : clip.item.clip_type === "remix" ? REMIX_AUDIO_VOLUME : 1}
        style={{
          width: isEnlarged ? "105%" : "100%",
          height: isEnlarged ? "105%" : "100%",
          position: isEnlarged ? "absolute" : undefined,
          left: isEnlarged ? "-2.5%" : undefined,
          top: isEnlarged ? "-2.5%" : undefined,
          objectFit: "contain",
        }}
      />
    </AbsoluteFill>
  );
};

const TitleOverlay: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = Math.min(frame / 10, 1);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: "8%",
      }}
    >
      <div
        style={{
          color: "white",
          fontSize: 72,
          fontFamily: "'Inter', sans-serif",
          fontWeight: 800,
          letterSpacing: "-0.04em",
          textShadow: "0 0 20px rgba(0,0,0,0.9), 0 0 40px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.8)",
          opacity,
          textAlign: "center",
          padding: "12px 24px",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const TITLE_SFX_VOLUME = 0.5;
const TITLE_SFX_DURATION_FRAMES = Math.round(0.15 * FPS); // ~5 frames

const TitleLayer: React.FC<{ titleItems?: TitleItem[]; baseUrl?: string; sfxTitleInPath?: string; sfxTitleOutPath?: string }> = ({ titleItems: propItems, baseUrl = "", sfxTitleInPath, sfxTitleOutPath }) => {
  const storeItems = useTimelineStore((s) => s.titleItems);
  const titleItems = propItems ?? storeItems;

  return (
    <>
      {titleItems.map((ti) => {
        const startFrame = secondsToFrames(ti.start_time);
        const durationInFrames = secondsToFrames(ti.end_time - ti.start_time);
        if (durationInFrames <= 0) return null;

        const endFrame = startFrame + durationInFrames;

        return (
          <React.Fragment key={`title-${ti.id}`}>
            <Sequence from={startFrame} durationInFrames={durationInFrames}>
              <TitleOverlay text={ti.text} />
            </Sequence>
            {/* Title in SFX */}
            <Sequence from={startFrame} durationInFrames={TITLE_SFX_DURATION_FRAMES}>
              <Audio src={sfxTitleInPath || `${baseUrl}/api/sfx/title-in`} volume={TITLE_SFX_VOLUME} />
            </Sequence>
            {/* Title out SFX */}
            <Sequence from={endFrame} durationInFrames={TITLE_SFX_DURATION_FRAMES}>
              <Audio src={sfxTitleOutPath || `${baseUrl}/api/sfx/title-out`} volume={TITLE_SFX_VOLUME} />
            </Sequence>
          </React.Fragment>
        );
      })}
    </>
  );
};

const CaptionOverlay: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = Math.min(frame / 5, 1);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: "3%",
      }}
    >
      <div
        style={{
          color: "white",
          fontSize: 36,
          fontFamily: "'Inter', sans-serif",
          fontWeight: 600,
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          padding: "8px 20px",
          borderRadius: 6,
          opacity,
          textAlign: "center",
          maxWidth: "80%",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const CaptionLayer: React.FC<{ captionItems?: CaptionItem[] }> = ({ captionItems: propItems }) => {
  const storeItems = useTimelineStore((s) => s.captionItems);
  const captionItems = propItems ?? storeItems;

  return (
    <>
      {captionItems.map((ci) => {
        const startFrame = secondsToFrames(ci.start_time);
        const durationInFrames = secondsToFrames(ci.end_time - ci.start_time);
        if (durationInFrames <= 0) return null;

        return (
          <Sequence
            key={`caption-${ci.id}`}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <CaptionOverlay text={ci.text} />
          </Sequence>
        );
      })}
    </>
  );
};

const TimestampOverlay: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = Math.min(frame / 10, 1);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "flex-start",
        padding: "4% 4%",
      }}
    >
      <div
        style={{
          color: "white",
          fontSize: 36,
          fontFamily: "'Inter', sans-serif",
          fontWeight: 600,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          padding: "8px 18px",
          borderRadius: 8,
          opacity,
          letterSpacing: "0.02em",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const TimestampLayer: React.FC<{ timestampItems?: TimestampItem[] }> = ({ timestampItems: propItems }) => {
  const storeItems = useTimelineStore((s) => s.timestampItems);
  const timestampItems = propItems ?? storeItems;

  return (
    <>
      {timestampItems.map((ts) => {
        const startFrame = secondsToFrames(ts.start_time);
        const durationInFrames = secondsToFrames(ts.end_time - ts.start_time);
        if (durationInFrames <= 0) return null;

        return (
          <Sequence
            key={`timestamp-${ts.id}`}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <TimestampOverlay text={ts.text} />
          </Sequence>
        );
      })}
    </>
  );
};

const TrackerLayer: React.FC<{ trackerItems?: TrackerItem[]; baseUrl?: string }> = ({
  trackerItems: propItems,
  baseUrl = "",
}) => {
  const storeItems = useTimelineStore((s) => s.trackerItems);
  const trackerItems = propItems ?? storeItems;

  return (
    <>
      {trackerItems.map((ti) => {
        const startFrame = secondsToFrames(ti.start_time);
        const durationInFrames = secondsToFrames(ti.end_time - ti.start_time);
        if (durationInFrames <= 0) return null;

        return (
          <Sequence
            key={`tracker-${ti.id}`}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <AbsoluteFill>
              <OffthreadVideo
                src={`${baseUrl}${ti.overlay_url}`}
                transparent
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </>
  );
};

const SUBSCRIBE_ANIM_FRAMES = 15;

const SubscribeOverlay: React.FC<{ text: string; durationInFrames: number }> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame();

  let translateY = 100;
  if (frame < SUBSCRIBE_ANIM_FRAMES) {
    translateY = 100 - (frame / SUBSCRIBE_ANIM_FRAMES) * 100;
  } else if (frame > durationInFrames - SUBSCRIBE_ANIM_FRAMES) {
    const outFrame = frame - (durationInFrames - SUBSCRIBE_ANIM_FRAMES);
    translateY = (outFrame / SUBSCRIBE_ANIM_FRAMES) * 100;
  } else {
    translateY = 0;
  }

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: "12%",
      }}
    >
      <div
        style={{
          color: "white",
          fontSize: 48,
          fontFamily: "'Inter', sans-serif",
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          textShadow: "0 0 16px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.6)",
          transform: `translateY(${translateY}%)`,
          padding: "10px 28px",
          borderRadius: 8,
          backgroundColor: "rgba(255, 0, 0, 0.85)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const SubscribeLayer: React.FC<{ subscribeItems?: SubscribeItem[] }> = ({ subscribeItems: propItems }) => {
  const storeItems = useTimelineStore((s) => s.subscribeItems);
  const subscribeItems = propItems ?? storeItems;

  return (
    <>
      {subscribeItems.map((si) => {
        const startFrame = secondsToFrames(si.start_time);
        const durationInFrames = secondsToFrames(si.end_time - si.start_time);
        if (durationInFrames <= 0) return null;

        return (
          <Sequence
            key={`subscribe-${si.id}`}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <SubscribeOverlay text={si.text} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
    </>
  );
};

const MusicLayer: React.FC<{ musicItems?: MusicItem[]; volumeEnvelope?: VolumeKeypoint[]; baseUrl?: string }> = ({
  musicItems: propItems,
  volumeEnvelope: propEnvelope,
  baseUrl = "",
}) => {
  const storeItems = useTimelineStore((s) => s.musicItems);
  const storeEnvelope = useTimelineStore((s) => s.volumeEnvelope);
  const musicItems = propItems ?? storeItems;
  const volumeEnvelope = propEnvelope ?? storeEnvelope;

  const makeVolumeCallback = useCallback(
    (musicStartTime: number) => {
      return (frame: number) => {
        const timeInMusic = frame / FPS;
        const timelineTime = musicStartTime + timeInMusic;
        return interpolateEnvelope(volumeEnvelope, timelineTime);
      };
    },
    [volumeEnvelope],
  );

  return (
    <>
      {musicItems.map((mi) => {
        const startFrame = secondsToFrames(mi.start_time);
        const durationInFrames = secondsToFrames(mi.end_time - mi.start_time);
        if (durationInFrames <= 0) return null;

        return (
          <Sequence
            key={`music-${mi.id}`}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <Audio
              src={mi.file_path || `${baseUrl}/api/assets/${mi.asset_id}/file`}
              volume={makeVolumeCallback(mi.start_time)}
            />
          </Sequence>
        );
      })}
    </>
  );
};
