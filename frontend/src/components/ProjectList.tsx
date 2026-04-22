import { useEffect, useState } from "react";
import { useTimelineStore } from "../stores/timelineStore";
import type { Project } from "../types";

const DEFAULT_DESC_PROMPT =
  "You are a YouTube description writer. Write a compelling video description " +
  "based on the transcript and title provided. Include:\n" +
  "- A hook/summary in the first 2 lines (this shows in search results)\n" +
  "- Key topics covered\n" +
  "- A call to action (like, subscribe, comment)\n\n" +
  "Keep it under 300 words. Do not include timestamps or hashtags.";

export function ProjectList() {
  const {
    setProject, setClips, setTimelineItems, setIsWatching, setScanningFiles,
    setSelectedTitle, setVideoDescription, setVideoTags,
    setVideoCategory, setVideoVisibility, setSelectedThumbnailIndices, setDescSystemPrompt,
    setThumbnailUrls, setThumbnailText,
    setRenderProgress, setYoutubeUploadProgress, setYoutubeUploadResult, setYoutubeUploadError,
    setMusicItems, setVolumeEnvelope,
    setTitleItems,
    setCaptionItems,
    setTimestampItems,
    setTrackerItems,
    setSubscribeItems,
    setZoomItems,
    setEnlargeItems,
    setAnalyzeItems,
  } = useTimelineStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) setProjects(await res.json());
    } catch {} finally {
      setLoading(false);
    }
  };

  const openProject = async (id: number) => {
    const fullRes = await fetch(`/api/projects/${id}`);
    const proj = await fullRes.json();
    // Restore saved metadata BEFORE setting project, so auto-save doesn't wipe it
    setSelectedTitle(proj.selected_title || null);
    setVideoDescription(proj.video_description || "");
    setVideoTags(proj.video_tags ? JSON.parse(proj.video_tags) : []);
    setVideoCategory(proj.video_category || "22");
    setVideoVisibility(proj.video_visibility || "private");
    setSelectedThumbnailIndices(proj.locked_thumbnail_indices ? JSON.parse(proj.locked_thumbnail_indices) : []);
    setDescSystemPrompt(proj.desc_system_prompt || DEFAULT_DESC_PROMPT);
    setThumbnailUrls(proj.thumbnail_urls ? JSON.parse(proj.thumbnail_urls) : []);
    setThumbnailText(proj.thumbnail_text || proj.selected_title || "");
    // Reset render/upload state (render_path on project object handles "Previously exported")
    setRenderProgress(null);
    setYoutubeUploadProgress(null);
    setYoutubeUploadResult(null);
    setYoutubeUploadError(null);

    // Navigate immediately with existing clips
    setProject(proj);
    setClips(proj.clips || []);
    const tlRes = await fetch(`/api/timeline/${id}`);
    if (tlRes.ok) setTimelineItems(await tlRes.json());
    // Load music items
    fetch(`/api/music/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setMusicItems(data.items || []);
          setVolumeEnvelope(data.volume_envelope || []);
        }
      });
    // Load title items
    fetch(`/api/titles/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setTitleItems(data.items || []);
      });
    // Load caption items
    fetch(`/api/captions/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setCaptionItems(data.items || []);
      });
    // Load timestamp items
    fetch(`/api/timestamps/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setTimestampItems(data.items || []);
      });
    // Load tracker items
    fetch(`/api/trackers/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setTrackerItems(data.items || []);
      });
    // Load subscribe items
    fetch(`/api/subscribes/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setSubscribeItems(data.items || []);
      });
    // Load zoom items
    fetch(`/api/zooms/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setZoomItems(data.items || []);
      });
    // Load enlarge items
    fetch(`/api/enlarges/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setEnlargeItems(data.items || []);
      });
    // Load analyze items
    fetch(`/api/analyzes/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setAnalyzeItems(data.items || []);
      });
    setIsWatching(true);
    // Start watching in background — new clips arrive via websocket
    setScanningFiles(true);
    fetch(`/api/projects/${id}/watch/start`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => { if (data.clips?.length) setClips(data.clips); })
      .finally(() => setScanningFiles(false));
  };

  const browse = async () => {
    setBrowsing(true);
    try {
      const res = await fetch("/api/fs/pick-folder");
      const data = await res.json();
      if (data.path && !data.cancelled) {
        setDir(data.path.replace(/\/$/, ""));
      }
    } catch {} finally {
      setBrowsing(false);
    }
  };

  const createProject = async () => {
    if (!name.trim() || !dir.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), watch_directory: dir.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to create project");
      }
      const proj = await res.json();
      // Reset metadata to defaults BEFORE setting project so auto-save doesn't persist stale values
      setSelectedTitle(null);
      setVideoDescription("");
      setVideoTags([]);
      setVideoCategory("22");
      setVideoVisibility("private");
      setSelectedThumbnailIndices([]);
      setDescSystemPrompt(DEFAULT_DESC_PROMPT);
      setThumbnailUrls([]);
      setThumbnailText("");
      // Reset render/upload state
      setRenderProgress(null);
      setYoutubeUploadProgress(null);
      setYoutubeUploadResult(null);
      setYoutubeUploadError(null);
      setTitleItems([]);
      setCaptionItems([]);
      setTimestampItems([]);
      setTrackerItems([]);
      setSubscribeItems([]);
      setZoomItems([]);
      setEnlargeItems([]);
      setMusicItems([]);
      setVolumeEnvelope([]);
      // Navigate immediately — don't wait for scan
      setProject(proj);
      setClips([]);
      setTimelineItems([]);
      setIsWatching(true);
      // Start watching in background — clips arrive via websocket
      setScanningFiles(true);
      fetch(`/api/projects/${proj.id}/watch/start`, { method: "POST" })
        .then((r) => r.json())
        .then((data) => { if (data.clips?.length) setClips(data.clips); })
        .finally(() => setScanningFiles(false));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (e: React.MouseEvent, id: number, projectName: string) => {
    e.stopPropagation();
    if (!confirm(`Delete "${projectName}"? This cannot be undone.`)) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setProjects(projects.filter((p) => p.id !== id));
  };

  if (loading) {
    return <div className="project-list-loading">Loading projects...</div>;
  }

  return (
    <div className="project-list">
      <h2>Projects</h2>
      <div className="project-grid">
        {projects.map((p) => (
          <div key={p.id} className="project-card" onClick={() => openProject(p.id)}>
            <div className="project-card-header">
              <h3>{p.name}</h3>
              <button
                className="project-card-delete"
                onClick={(e) => deleteProject(e, p.id, p.name)}
                title="Delete project"
              >
                x
              </button>
            </div>
            <span className="project-card-dir">{p.watch_directory}</span>
            <span className="project-card-clips">{p.clips.length} clips</span>
          </div>
        ))}
        {!showForm ? (
          <div className="project-card new-project-card" onClick={() => setShowForm(true)}>
            <span className="new-project-icon">+</span>
            <span>New Project</span>
          </div>
        ) : (
          <div className="project-card new-project-form">
            <input
              type="text"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <div className="folder-input-row">
              <input
                type="text"
                placeholder="Watch folder"
                value={dir}
                onChange={(e) => setDir(e.target.value)}
                readOnly={browsing}
              />
              <button className="btn btn-ghost" onClick={browse} disabled={browsing}>
                {browsing ? "..." : "Browse"}
              </button>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={createProject} disabled={creating}>
                {creating ? "Creating..." : "Create"}
              </button>
              <button className="btn btn-ghost" onClick={() => { setShowForm(false); setError(""); }}>
                Cancel
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
