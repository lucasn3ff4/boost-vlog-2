from pydantic import BaseModel


class ProjectCreate(BaseModel):
    name: str
    watch_directory: str


class SubClipResponse(BaseModel):
    id: int
    start_time: float
    end_time: float
    score: float | None
    label: str | None

    class Config:
        from_attributes = True


class ClipResponse(BaseModel):
    id: int
    source_path: str
    processed_path: str | None
    clip_type: str | None
    status: str
    duration: float | None
    transcript: str | None
    error_message: str | None
    sub_clips: list[SubClipResponse]

    class Config:
        from_attributes = True


class ProjectResponse(BaseModel):
    id: int
    name: str
    watch_directory: str
    clips: list[ClipResponse]
    selected_title: str | None = None
    video_description: str | None = None
    video_tags: str | None = None  # JSON string
    video_category: str | None = "22"
    video_visibility: str | None = "private"
    selected_thumbnail_idx: int | None = None
    desc_system_prompt: str | None = None
    thumbnail_urls: str | None = None
    locked_thumbnail_indices: str | None = None
    thumbnail_text: str | None = None
    render_path: str | None = None

    class Config:
        from_attributes = True


class ProjectMetadataUpdate(BaseModel):
    selected_title: str | None = None
    video_description: str | None = None
    video_tags: str | None = None
    video_category: str | None = None
    video_visibility: str | None = None
    selected_thumbnail_idx: int | None = None
    desc_system_prompt: str | None = None
    thumbnail_urls: str | None = None
    locked_thumbnail_indices: str | None = None
    thumbnail_text: str | None = None


class TimelineItemResponse(BaseModel):
    id: int
    clip_id: int | None
    sub_clip_id: int | None
    position: int
    video_url: str
    duration: float
    start_time: float
    end_time: float
    label: str
    clip_type: str | None

    class Config:
        from_attributes = True


class TimelineItemUpdate(BaseModel):
    clip_id: int | None = None
    sub_clip_id: int | None = None
    position: int


class TimelineUpdate(BaseModel):
    items: list[TimelineItemUpdate]


class TitleSuggestionsResponse(BaseModel):
    titles: list[str]


class ThumbnailRequest(BaseModel):
    title: str
    skip_indices: list[int] = []


class ThumbnailResponse(BaseModel):
    thumbnail_urls: list[str]


class MetadataRequest(BaseModel):
    title: str
    system_prompt: str | None = None


class YouTubeUploadRequest(BaseModel):
    title: str
    description: str = ""
    tags: list[str] = []
    category_id: str = "22"
    privacy_status: str = "private"
    thumbnail_index: int | None = None


class DescriptionResponse(BaseModel):
    description: str


class TagsResponse(BaseModel):
    tags: list[str]


class AssetResponse(BaseModel):
    id: int
    name: str
    file_path: str
    asset_type: str
    duration: float

    class Config:
        from_attributes = True


class MusicItemResponse(BaseModel):
    id: int
    asset_id: int
    asset_name: str
    start_time: float
    end_time: float
    volume: float

    class Config:
        from_attributes = True


class VolumeKeypoint(BaseModel):
    t: float
    v: float


class MusicAutoResponse(BaseModel):
    items: list[MusicItemResponse]
    volume_envelope: list[VolumeKeypoint]


class TitleItemResponse(BaseModel):
    id: int
    text: str
    start_time: float
    end_time: float

    class Config:
        from_attributes = True


class TitleItemUpdate(BaseModel):
    text: str | None = None
    start_time: float | None = None
    end_time: float | None = None


class TitleAutoResponse(BaseModel):
    items: list[TitleItemResponse]


class CaptionItemResponse(BaseModel):
    id: int
    text: str
    start_time: float
    end_time: float

    class Config:
        from_attributes = True


class CaptionItemUpdate(BaseModel):
    text: str | None = None
    start_time: float | None = None
    end_time: float | None = None


class CaptionAutoResponse(BaseModel):
    items: list[CaptionItemResponse]


class TimestampItemResponse(BaseModel):
    id: int
    text: str
    start_time: float
    end_time: float

    class Config:
        from_attributes = True


class TimestampItemUpdate(BaseModel):
    text: str | None = None
    start_time: float | None = None
    end_time: float | None = None


class TimestampAutoResponse(BaseModel):
    items: list[TimestampItemResponse]


class TrackerItemResponse(BaseModel):
    id: int
    start_time: float
    end_time: float
    overlay_url: str

    class Config:
        from_attributes = True


class TrackerAutoResponse(BaseModel):
    items: list[TrackerItemResponse]


class SubscribeItemResponse(BaseModel):
    id: int
    text: str
    start_time: float
    end_time: float

    class Config:
        from_attributes = True


class SubscribeItemUpdate(BaseModel):
    text: str | None = None
    start_time: float | None = None
    end_time: float | None = None


class SubscribeAutoResponse(BaseModel):
    items: list[SubscribeItemResponse]


class ZoomItemResponse(BaseModel):
    id: int
    start_time: float
    end_time: float

    class Config:
        from_attributes = True


class ZoomItemUpdate(BaseModel):
    start_time: float | None = None
    end_time: float | None = None


class ZoomAutoResponse(BaseModel):
    items: list[ZoomItemResponse]


class EnlargeItemResponse(BaseModel):
    id: int
    start_time: float
    end_time: float

    class Config:
        from_attributes = True


class EnlargeItemUpdate(BaseModel):
    start_time: float | None = None
    end_time: float | None = None


class EnlargeAutoResponse(BaseModel):
    items: list[EnlargeItemResponse]


class RemixAutoResponse(BaseModel):
    items: list[TimelineItemResponse]


class HookAutoResponse(BaseModel):
    items: list[TimelineItemResponse]


class AnalyzeItemResponse(BaseModel):
    id: int
    clip_id: int | None = None
    sub_clip_id: int | None = None
    text: str
    start_time: float
    end_time: float

    class Config:
        from_attributes = True


class AnalyzeAutoResponse(BaseModel):
    items: list[AnalyzeItemResponse]


class SettingsResponse(BaseModel):
    timezone: str


class SettingsUpdate(BaseModel):
    timezone: str | None = None
