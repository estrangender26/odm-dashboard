import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Download,
  FileText,
  Loader2,
  Presentation,
  Search,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import { deckGeneratorRegistry } from "@/modules/presentation-center/generators";
import {
  ALL_BUSINESS_UNITS_LABEL,
  EXECUTIVE_SCORECARD_TEMPLATE,
  getAvailableMonthlyKpiOptions,
  getReportingPeriodLabel,
  MONTH_NAMES,
  MONTHLY_KPI_BUSINESS_UNITS,
  MONTHLY_KPI_TEMPLATE_OPTIONS,
  type MonthlyKpiAvailableOptions,
} from "@/modules/presentation-center/scorecardData";
import {
  blobToDataUrl,
  downloadDataUrl,
  getGeneratedPresentations,
  getUploadedPresentations,
  saveGeneratedPresentations,
  saveUploadedPresentations,
} from "@/modules/presentation-center/storage";
import type {
  DeckGenerationContext,
  GeneratedPresentation,
  MonthlyKpiTemplate,
  PresentationCategory,
  UploadedPresentation,
} from "@/modules/presentation-center/types";

const categoryOptions: PresentationCategory[] = [
  "Uploaded Deck",
  "Monthly KPI Scorecard",
  "O&M Manual Library",
  "O&M Manual Governance",
  "Post-PPP Planning",
  "Maintenance Planning",
  "Standard Maintenance Procedures",
  "Gantt Planner",
  "Operator Driven Maintenance",
  "Executive Dashboard",
  "Other",
];

type SortKey = "newest" | "oldest" | "name" | "size" | "category";

const monthlyKpiGeneratorId = "monthly-kpi-scorecard";

const emptyMonthlyKpiOptions: MonthlyKpiAvailableOptions = {
  years: [],
  months: [],
  businessUnits: [],
};

type MonthlyKpiSelection = {
  reportingYear: string;
  reportingMonth: string;
  businessUnit: string;
  template: MonthlyKpiTemplate;
};

const defaultMonthlyKpiSelection: MonthlyKpiSelection = {
  reportingYear: "",
  reportingMonth: "",
  businessUnit: ALL_BUSINESS_UNITS_LABEL,
  template: EXECUTIVE_SCORECARD_TEMPLATE,
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatReportingPeriod(month?: number, year?: number) {
  if (!month || !year) return "";
  return getReportingPeriodLabel(month, year);
}

export default function PresentationCenter() {
  const [uploaded, setUploaded] = useState<UploadedPresentation[]>(() =>
    getUploadedPresentations()
  );
  const [generated, setGenerated] = useState<GeneratedPresentation[]>(() =>
    getGeneratedPresentations()
  );
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [category, setCategory] =
    useState<PresentationCategory>("Uploaded Deck");
  const [isUploading, setIsUploading] = useState(false);
  const [activeGeneratorId, setActiveGeneratorId] = useState<string | null>(
    null
  );
  const [monthlyKpiDialogOpen, setMonthlyKpiDialogOpen] = useState(false);
  const [monthlyKpiDialogGeneratorId, setMonthlyKpiDialogGeneratorId] =
    useState<string | null>(null);
  const [monthlyKpiSelection, setMonthlyKpiSelection] =
    useState<MonthlyKpiSelection>(defaultMonthlyKpiSelection);
  const [monthlyKpiOptions, setMonthlyKpiOptions] =
    useState<MonthlyKpiAvailableOptions>(emptyMonthlyKpiOptions);
  const [monthlyKpiOptionsLoading, setMonthlyKpiOptionsLoading] =
    useState(false);
  const [monthlyKpiOptionsError, setMonthlyKpiOptionsError] = useState<
    string | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const monthlyKpiBusinessUnitOptions = [
    ALL_BUSINESS_UNITS_LABEL,
    ...(monthlyKpiOptions.businessUnits.length
      ? monthlyKpiOptions.businessUnits
      : MONTHLY_KPI_BUSINESS_UNITS),
  ];
  const monthlyKpiCanGenerate =
    Boolean(
      monthlyKpiSelection.reportingYear &&
      monthlyKpiSelection.reportingMonth &&
      monthlyKpiSelection.businessUnit &&
      monthlyKpiSelection.template
    ) &&
    !monthlyKpiOptionsLoading &&
    !monthlyKpiOptionsError &&
    monthlyKpiOptions.years.length > 0 &&
    monthlyKpiOptions.months.length > 0;

  const filteredUploaded = useMemo(() => {
    const normalizedQuery = query.toLowerCase().trim();
    return uploaded
      .filter(deck =>
        [deck.name, deck.uploadedBy, deck.category]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
      .sort((a, b) => {
        if (sortKey === "oldest")
          return (
            new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime()
          );
        if (sortKey === "name") return a.name.localeCompare(b.name);
        if (sortKey === "size") return b.size - a.size;
        if (sortKey === "category") return a.category.localeCompare(b.category);
        return (
          new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
        );
      });
  }, [query, sortKey, uploaded]);

  async function handleUpload(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (
      !file.name.toLowerCase().endsWith(".pptx") ||
      file.type === "application/vnd.ms-powerpoint"
    ) {
      toast.error(
        "Unsupported file type. Please upload a .pptx PowerPoint file."
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsUploading(true);
    try {
      const dataUrl = await blobToDataUrl(file);
      const deck: UploadedPresentation = {
        id: crypto.randomUUID(),
        name: file.name,
        uploadDate: new Date().toISOString(),
        uploadedBy: "ODM User",
        size: file.size,
        category,
        dataUrl,
      };
      const next = [deck, ...uploaded];
      setUploaded(next);
      saveUploadedPresentations(next);
      toast.success("Presentation uploaded successfully.");
    } catch (error) {
      console.error("[PresentationCenter] Upload failed", error);
      toast.error("Upload failed. Please try again with a valid .pptx file.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function openMonthlyKpiDialog(generatorId: string) {
    setMonthlyKpiDialogGeneratorId(generatorId);
    setMonthlyKpiDialogOpen(true);
    setMonthlyKpiOptionsLoading(true);
    setMonthlyKpiOptionsError(null);
    try {
      const options = await getAvailableMonthlyKpiOptions();
      setMonthlyKpiOptions(options);
      if (options.years.length === 0 || options.months.length === 0) {
        setMonthlyKpiSelection(defaultMonthlyKpiSelection);
        setMonthlyKpiOptionsError(
          "No persisted Monthly KPI records are available for presentation generation."
        );
        return;
      }
      setMonthlyKpiSelection(previous => {
        const previousYear = Number(previous.reportingYear);
        const previousMonth = Number(previous.reportingMonth);
        const businessUnit =
          previous.businessUnit !== ALL_BUSINESS_UNITS_LABEL &&
          options.businessUnits.includes(previous.businessUnit)
            ? previous.businessUnit
            : ALL_BUSINESS_UNITS_LABEL;
        return {
          reportingYear: String(
            options.years.includes(previousYear)
              ? previousYear
              : options.years[0]
          ),
          reportingMonth: String(
            options.months.includes(previousMonth)
              ? previousMonth
              : options.months[0]
          ),
          businessUnit,
          template: EXECUTIVE_SCORECARD_TEMPLATE,
        };
      });
    } catch (error) {
      console.error("[PresentationCenter] Monthly KPI options failed", error);
      setMonthlyKpiOptions(emptyMonthlyKpiOptions);
      setMonthlyKpiSelection(defaultMonthlyKpiSelection);
      setMonthlyKpiOptionsError(
        "Unable to load persisted Monthly KPI records. Please try again."
      );
      toast.error("Unable to load Monthly KPI generation options.");
    } finally {
      setMonthlyKpiOptionsLoading(false);
    }
  }

  async function runGenerator(
    generatorId: string,
    generationContext: Omit<Partial<DeckGenerationContext>, "generatedBy"> = {}
  ) {
    const generator = deckGeneratorRegistry.find(
      item => item.id === generatorId
    );
    if (!generator) return false;
    if (!generator.enabled || !generator.generate) {
      toast.info("Generator not yet implemented. Reserved for future release.");
      return false;
    }
    setActiveGeneratorId(generatorId);
    toast.loading("Generating presentation…", { id: generatorId });
    try {
      const deck = await generator.generate({
        generatedBy: "ODM User",
        ...generationContext,
      });
      const next = [deck, ...generated];
      setGenerated(next);
      saveGeneratedPresentations(next);
      toast.success("Presentation generated successfully.", {
        id: generatorId,
      });
      downloadDataUrl(deck.dataUrl, deck.name);
      return true;
    } catch (error) {
      console.error("[PresentationCenter] Generation failed", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Presentation generation failed.",
        { id: generatorId }
      );
      return false;
    } finally {
      setActiveGeneratorId(null);
    }
  }

  async function handleMonthlyKpiGenerate() {
    if (!monthlyKpiDialogGeneratorId) return;
    const reportingYear = Number(monthlyKpiSelection.reportingYear);
    const reportingMonth = Number(monthlyKpiSelection.reportingMonth);
    if (!Number.isInteger(reportingYear) || !Number.isInteger(reportingMonth)) {
      toast.error("Select a valid reporting year and month.");
      return;
    }
    const generatedDeck = await runGenerator(monthlyKpiDialogGeneratorId, {
      reportingYear,
      reportingMonth,
      businessUnit: monthlyKpiSelection.businessUnit,
      template: monthlyKpiSelection.template,
    });
    if (generatedDeck) {
      setMonthlyKpiDialogOpen(false);
      setMonthlyKpiDialogGeneratorId(null);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#F6F8FB] text-slate-900"
      style={{
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <Toaster richColors position="top-right" />
      <header
        className="sticky top-0 z-30 text-white shadow-md"
        style={{
          background:
            "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)",
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center px-4 py-3">
          <Link
            to="/"
            aria-label="Dashboard Home"
            title="Dashboard Home"
            className="flex items-center gap-3 text-white no-underline"
          >
            <ProgramsEngineeringLogo size={44} borderRadius={8} />
            <div>
              <h1 className="text-base font-bold leading-tight sm:text-lg">
                Presentation Center
              </h1>
              <p className="text-[0.65rem] uppercase tracking-[0.22em] opacity-70">
                PowerPoint Hub
              </p>
            </div>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:py-8">
        <section className="rounded-2xl border border-[#D6DFE8] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#005BAC]">
                ODM Dashboard Module
              </p>
              <h2 className="mt-2 text-2xl font-bold text-[#0B1D44] sm:text-3xl">
                Create, manage, and generate PowerPoint presentations from
                dashboard data.
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Upload approved decks, generate Monthly KPI Scorecard
                presentations, and keep a recent history of generated PowerPoint
                files for download.
              </p>
            </div>
            <div className="grid min-w-[220px] grid-cols-2 gap-3 rounded-xl bg-[#EEF6FF] p-4 text-center">
              <div>
                <div className="text-2xl font-bold text-[#005BAC]">
                  {uploaded.length}
                </div>
                <div className="text-xs text-slate-600">Uploaded</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-[#005BAC]">
                  {generated.length}
                </div>
                <div className="text-xs text-slate-600">Generated</div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#D6DFE8] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-[#0B1D44]">
                <FileText className="h-5 w-5 text-[#005BAC]" /> Uploaded Deck
                Library
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Upload, search, sort, and download .pptx presentation files.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="relative lg:col-span-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  className="h-10 w-full rounded-lg border border-[#D6DFE8] pl-9 pr-3 text-sm outline-none focus:border-[#005BAC]"
                  placeholder="Search presentations"
                />
              </label>
              <select
                value={sortKey}
                onChange={event => setSortKey(event.target.value as SortKey)}
                className="h-10 rounded-lg border border-[#D6DFE8] px-3 text-sm outline-none focus:border-[#005BAC]"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name</option>
                <option value="size">File size</option>
                <option value="category">Category</option>
              </select>
              <select
                value={category}
                onChange={event =>
                  setCategory(event.target.value as PresentationCategory)
                }
                className="h-10 rounded-lg border border-[#D6DFE8] px-3 text-sm outline-none focus:border-[#005BAC]"
              >
                {categoryOptions.map(option => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-dashed border-[#9BB7D4] bg-[#F8FBFF] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-[#0B1D44]">
                Upload PowerPoint files (.pptx only)
              </p>
              <p className="text-sm text-slate-600">
                Unsupported file types are rejected with a user-friendly
                message.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              onChange={event => void handleUpload(event.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#005BAC] px-4 text-sm font-semibold text-white transition hover:bg-[#004A8F] disabled:opacity-60"
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}{" "}
              {isUploading ? "Uploading…" : "Upload Deck"}
            </button>
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-[#E2E8F0]">
            <table className="min-w-full divide-y divide-[#E2E8F0] text-sm">
              <thead className="bg-[#F1F5F9] text-left text-xs font-bold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">File name</th>
                  <th className="px-4 py-3">Upload date</th>
                  <th className="px-4 py-3">Uploaded by</th>
                  <th className="px-4 py-3">File size</th>
                  <th className="px-4 py-3">Type/category</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] bg-white">
                {filteredUploaded.map(deck => (
                  <tr key={deck.id}>
                    <td className="px-4 py-3 font-semibold text-[#0B1D44]">
                      {deck.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(deck.uploadDate)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {deck.uploadedBy}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatBytes(deck.size)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-[#DBEAFE] px-2.5 py-1 text-xs font-semibold text-[#005BAC]">
                        {deck.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => downloadDataUrl(deck.dataUrl, deck.name)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6DFE8] px-3 py-1.5 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredUploaded.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-sm text-slate-500"
                    >
                      No presentations uploaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-[#D6DFE8] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="flex items-center gap-2 text-xl font-bold text-[#0B1D44]">
            <WandSparkles className="h-5 w-5 text-[#005BAC]" /> Generate Decks
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Generators are registered through an extensible registry so future
            deck types can be added without refactoring this page.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {deckGeneratorRegistry.map(generator => {
              const isActive = activeGeneratorId === generator.id;
              return (
                <article
                  key={generator.id}
                  className="flex min-h-[300px] flex-col rounded-xl border border-[#D6DFE8] bg-[#FFFFFF] p-4 shadow-sm"
                >
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[#EEF6FF] text-[#005BAC]">
                    <Presentation className="h-5 w-5" />
                  </div>
                  <h3 className="font-bold text-[#0B1D44]">
                    {generator.title}
                  </h3>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[#005BAC]">
                    {generator.category}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {generator.description}
                  </p>
                  <div className="mt-3 flex-1 rounded-lg bg-[#F8FAFC] p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Suggested slide outline
                    </p>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5 text-slate-600">
                      {generator.slideOutline.map(slide => (
                        <li key={slide}>{slide}</li>
                      ))}
                    </ol>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${generator.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                    >
                      {generator.status === "active" ? "ACTIVE" : "Coming Soon"}
                    </span>
                    <button
                      onClick={() =>
                        generator.id === monthlyKpiGeneratorId
                          ? void openMonthlyKpiDialog(generator.id)
                          : void runGenerator(generator.id)
                      }
                      disabled={isActive}
                      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition disabled:opacity-60 ${generator.enabled ? "bg-[#005BAC] text-white hover:bg-[#004A8F]" : "border border-[#D6DFE8] bg-white text-[#005BAC] hover:bg-[#EEF6FF]"}`}
                    >
                      {isActive && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {isActive
                        ? "Generating…"
                        : generator.enabled
                          ? "Generate PPTX"
                          : "View Status"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-[#D6DFE8] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-bold text-[#0B1D44]">
            Recent Presentations
          </h2>
          <div className="mt-4 overflow-x-auto rounded-xl border border-[#E2E8F0]">
            <table className="min-w-full divide-y divide-[#E2E8F0] text-sm">
              <thead className="bg-[#F1F5F9] text-left text-xs font-bold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Generated Date</th>
                  <th className="px-4 py-3">Generated By</th>
                  <th className="px-4 py-3">Download Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] bg-white">
                {generated.map(deck => (
                  <tr key={deck.id}>
                    <td className="px-4 py-3 font-semibold text-[#0B1D44]">
                      {deck.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{deck.type}</div>
                      {deck.reportingYear && deck.reportingMonth && (
                        <div className="mt-1 text-xs text-slate-500">
                          {formatReportingPeriod(
                            deck.reportingMonth,
                            deck.reportingYear
                          )}{" "}
                          • {deck.businessUnit || ALL_BUSINESS_UNITS_LABEL}
                        </div>
                      )}
                      {deck.template && (
                        <div className="mt-1 text-xs text-slate-500">
                          Template: {deck.template}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(deck.generatedDate)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {deck.generatedBy}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => downloadDataUrl(deck.dataUrl, deck.name)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6DFE8] px-3 py-1.5 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                    </td>
                  </tr>
                ))}
                {generated.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-sm text-slate-500"
                    >
                      No recent presentations yet. Generate a Monthly KPI
                      Scorecard deck to populate this table.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {monthlyKpiDialogOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="monthly-kpi-pptx-title"
            className="w-full max-w-2xl rounded-xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-5 py-4">
              <div>
                <h2
                  id="monthly-kpi-pptx-title"
                  className="text-lg font-bold text-[#0B1D44]"
                >
                  Generate Monthly KPI PPTX
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Select persisted Monthly KPI records for the Executive
                  Scorecard deck.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setMonthlyKpiDialogOpen(false);
                  setMonthlyKpiDialogGeneratorId(null);
                }}
                disabled={activeGeneratorId === monthlyKpiDialogGeneratorId}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#D6DFE8] text-slate-600 hover:bg-[#F8FAFC] disabled:opacity-60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              {monthlyKpiOptionsLoading && (
                <div className="flex items-center gap-2 rounded-lg border border-[#D6DFE8] bg-[#F8FBFF] px-3 py-2 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin text-[#005BAC]" />
                  Loading persisted Monthly KPI records...
                </div>
              )}

              {monthlyKpiOptionsError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {monthlyKpiOptionsError}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-[#0B1D44]">
                  Reporting Year
                  <select
                    value={monthlyKpiSelection.reportingYear}
                    onChange={event =>
                      setMonthlyKpiSelection(previous => ({
                        ...previous,
                        reportingYear: event.target.value,
                      }))
                    }
                    disabled={
                      monthlyKpiOptionsLoading ||
                      monthlyKpiOptions.years.length === 0
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {monthlyKpiOptions.years.length ? (
                      monthlyKpiOptions.years.map(year => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))
                    ) : (
                      <option value="">No years available</option>
                    )}
                  </select>
                </label>

                <label className="text-sm font-semibold text-[#0B1D44]">
                  Reporting Month
                  <select
                    value={monthlyKpiSelection.reportingMonth}
                    onChange={event =>
                      setMonthlyKpiSelection(previous => ({
                        ...previous,
                        reportingMonth: event.target.value,
                      }))
                    }
                    disabled={
                      monthlyKpiOptionsLoading ||
                      monthlyKpiOptions.months.length === 0
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {monthlyKpiOptions.months.length ? (
                      monthlyKpiOptions.months.map(month => (
                        <option key={month} value={month}>
                          {MONTH_NAMES[month - 1] || `Month ${month}`}
                        </option>
                      ))
                    ) : (
                      <option value="">No months available</option>
                    )}
                  </select>
                </label>

                <label className="text-sm font-semibold text-[#0B1D44]">
                  Business Unit
                  <select
                    value={monthlyKpiSelection.businessUnit}
                    onChange={event =>
                      setMonthlyKpiSelection(previous => ({
                        ...previous,
                        businessUnit: event.target.value,
                      }))
                    }
                    disabled={monthlyKpiOptionsLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {monthlyKpiBusinessUnitOptions.map(unit => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-[#0B1D44]">
                  Template
                  <select
                    value={monthlyKpiSelection.template}
                    onChange={event =>
                      setMonthlyKpiSelection(previous => ({
                        ...previous,
                        template: event.target.value as MonthlyKpiTemplate,
                      }))
                    }
                    disabled={monthlyKpiOptionsLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {MONTHLY_KPI_TEMPLATE_OPTIONS.map(template => (
                      <option key={template} value={template}>
                        {template}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-[#E2E8F0] px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setMonthlyKpiDialogOpen(false);
                  setMonthlyKpiDialogGeneratorId(null);
                }}
                disabled={activeGeneratorId === monthlyKpiDialogGeneratorId}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D6DFE8] px-4 text-sm font-semibold text-[#005BAC] hover:bg-[#EEF6FF] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleMonthlyKpiGenerate()}
                disabled={
                  !monthlyKpiCanGenerate ||
                  activeGeneratorId === monthlyKpiDialogGeneratorId
                }
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#005BAC] px-4 text-sm font-semibold text-white hover:bg-[#004A8F] disabled:opacity-60"
              >
                {activeGeneratorId === monthlyKpiDialogGeneratorId && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Generate PPTX
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
