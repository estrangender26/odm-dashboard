import { useEffect, useRef, useState } from "react";
import { init } from "pptx-preview";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize,
  Minimize,
  X,
} from "lucide-react";

export type PptxViewerProps = {
  fileUrl: string;
  fileName?: string;
  title?: string;
  onClose?: () => void;
};

export default function PptxViewer({
  fileUrl,
  fileName = "presentation.pptx",
  title,
  onClose,
}: PptxViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previewerRef = useRef<ReturnType<typeof init> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideCount, setSlideCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!containerRef.current) return;
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to load presentation (${response.status}).`
          );
        }
        const buffer = await response.arrayBuffer();

        if (!mounted) return;

        // Clean up any previous previewer
        if (previewerRef.current) {
          previewerRef.current.destroy();
          previewerRef.current = null;
        }

        const previewer = init(containerRef.current, {
          width: 1280,
          height: 720,
          mode: "slide",
        });
        previewerRef.current = previewer;

        await previewer.preview(buffer);
        if (!mounted) return;

        setSlideCount(previewer.slideCount);
        setCurrentIndex(previewer.currentIndex);
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        console.error("[PptxViewer] load failed", err);
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load the PowerPoint file."
        );
        setLoading(false);
      }
    }

    void load();

    return () => {
      mounted = false;
      if (previewerRef.current) {
        previewerRef.current.destroy();
        previewerRef.current = null;
      }
    };
  }, [fileUrl]);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const goToSlide = (index: number) => {
    const previewer = previewerRef.current;
    if (!previewer) return;
    const count = previewer.slideCount || 1;
    const next = Math.max(0, Math.min(index, count - 1));
    previewer.renderSingleSlide(next);
    setCurrentIndex(previewer.currentIndex);
  };

  const goNext = () => goToSlide(currentIndex + 1);
  const goPrev = () => goToSlide(currentIndex - 1);

  const toggleFullscreen = async () => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore fullscreen errors
    }
  };

  const handleDownload = () => {
    const anchor = document.createElement("a");
    anchor.href = fileUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <div className="flex h-full w-full flex-col bg-slate-950 text-white">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">
            {title || fileName}
          </h3>
          <p className="text-xs text-slate-400">
            {slideCount > 0
              ? `Slide ${currentIndex + 1} of ${slideCount}`
              : "Loading slides…"}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800"
            title="Download original PPTX"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Download</span>
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <>
                <Minimize className="h-4 w-4" />
                <span className="hidden sm:inline">Exit</span>
              </>
            ) : (
              <>
                <Maximize className="h-4 w-4" />
                <span className="hidden sm:inline">Fullscreen</span>
              </>
            )}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-sm font-medium hover:bg-slate-800"
              title="Close"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Slide area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-[#005BAC]" />
            <p className="text-sm text-slate-400">Loading presentation…</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6 text-center">
            <p className="text-lg font-semibold text-red-400">
              Failed to load presentation
            </p>
            <p className="mt-2 max-w-md text-sm text-slate-400">{error}</p>
          </div>
        )}
        <div
          ref={containerRef}
          className="pptx-viewer-canvas h-full w-full"
          aria-label="PowerPoint slide canvas"
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 border-t border-slate-800 px-4 py-3">
        <button
          type="button"
          onClick={goPrev}
          disabled={currentIndex <= 0 || slideCount <= 1}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous slide"
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <div className="min-w-[8rem] text-center text-sm text-slate-300">
          {slideCount > 0 ? `${currentIndex + 1} / ${slideCount}` : "—"}
        </div>
        <button
          type="button"
          onClick={goNext}
          disabled={currentIndex >= slideCount - 1 || slideCount <= 1}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next slide"
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
