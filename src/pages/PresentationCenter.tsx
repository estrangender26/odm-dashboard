import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Download,
  Edit3,
  Eye,
  FileText,
  Loader2,
  Play,
  Presentation,
  Replace,
  Search,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import PptxViewer from "@/components/PptxViewer";
import { toast, Toaster } from "sonner";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import { deckGeneratorRegistry } from "@/modules/presentation-center/generators";
import {
  ALL_BUSINESS_UNITS_LABEL,
  EXECUTIVE_SCORECARD_TEMPLATE,
  getAvailableMonthlyKpiOptions,
  getReportingPeriodLabel,
  isMonthlyKpiUiAcceptanceMode,
  MONTH_NAMES,
  MONTHLY_KPI_BUSINESS_UNITS,
  MONTHLY_KPI_TEMPLATE_OPTIONS,
  type MonthlyKpiAvailableOptions,
} from "@/modules/presentation-center/scorecardData";
import {
  ALL_FACILITIES_LABEL,
  getAvailableOdmScorecardOptions,
  getOdmMonthDateRange,
  ODM_EXECUTIVE_SUMMARY_TEMPLATE,
  ODM_TEMPLATE_OPTIONS,
  type OdmAvailableOptions,
} from "@/modules/presentation-center/odmScorecardData";
import {
  cleanupGeneratedPresentationsHistory,
  cleanupUploadedPresentationsHistory,
  clearGeneratedPresentationsHistory,
  createUploadedPresentation,
  deleteGeneratedPresentation,
  deleteUploadedPresentation,
  downloadDataUrl,
  mergeGeneratedPresentation,
  renameUploadedPresentation,
  replaceUploadedPresentation,
  saveGeneratedPresentations,
} from "@/modules/presentation-center/storage";
import { fetchGovernancePresentationData } from "@/modules/presentation-center/governanceFetch";
import type {
  DeckGenerationContext,
  GeneratedPresentation,
  MonthlyKpiTemplate,
  OdmTemplate,
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

const monthlyKpiGeneratorId = "monthly-kpi-executive-scorecard";

function isMonthlyKpiGenerator(id: string): boolean {
  return id === monthlyKpiGeneratorId || id === "monthly-kpi-scorecard";
}

const operatorDrivenMaintenanceGeneratorId = "operator-driven-maintenance";

const emptyMonthlyKpiOptions: MonthlyKpiAvailableOptions = {
  years: [],
  months: [],
  businessUnits: [],
};

const emptyOdmOptions: OdmAvailableOptions = {
  years: [],
  months: [],
  facilities: [],
  equipmentTypes: [],
  categories: [],
  inspectors: [],
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

type OdmSelection = {
  reportingYear: string;
  reportingMonth: string;
  dateFrom: string;
  dateTo: string;
  facility: string;
  equipmentType: string;
  category: string;
  inspector: string;
  template: OdmTemplate;
};

const defaultOdmSelection: OdmSelection = {
  reportingYear: "",
  reportingMonth: "",
  dateFrom: "",
  dateTo: "",
  facility: ALL_FACILITIES_LABEL,
  equipmentType: "",
  category: "",
  inspector: "",
  template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
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

function getOdmSelectionDateRange(yearValue: string, monthValue: string) {
  const reportingYear = Number(yearValue);
  const reportingMonth = Number(monthValue);
  if (!Number.isInteger(reportingYear) || !Number.isInteger(reportingMonth)) {
    return { dateFrom: "", dateTo: "" };
  }
  return getOdmMonthDateRange(reportingYear, reportingMonth);
}

export default function PresentationCenter() {
  const monthlyKpiAcceptanceMode = isMonthlyKpiUiAcceptanceMode();
  const [uploaded, setUploaded] = useState<UploadedPresentation[]>([]);
  const [generated, setGenerated] = useState<GeneratedPresentation[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
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
  const [odmDialogOpen, setOdmDialogOpen] = useState(false);
  const [odmDialogGeneratorId, setOdmDialogGeneratorId] =
    useState<string | null>(null);
  const [odmSelection, setOdmSelection] =
    useState<OdmSelection>(defaultOdmSelection);
  const [odmOptions, setOdmOptions] =
    useState<OdmAvailableOptions>(emptyOdmOptions);
  const [odmOptionsLoading, setOdmOptionsLoading] = useState(false);
  const [odmOptionsError, setOdmOptionsError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const [uploadDeleteCandidate, setUploadDeleteCandidate] =
    useState<UploadedPresentation | null>(null);
  const [uploadRenameCandidate, setUploadRenameCandidate] =
    useState<UploadedPresentation | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [uploadReplaceCandidate, setUploadReplaceCandidate] =
    useState<UploadedPresentation | null>(null);
  const [replaceKeepName, setReplaceKeepName] = useState(true);
  const [uploadDetailCandidate, setUploadDetailCandidate] =
    useState<UploadedPresentation | null>(null);
  const [generatedDetailCandidate, setGeneratedDetailCandidate] =
    useState<GeneratedPresentation | null>(null);
  const [viewerDeck, setViewerDeck] = useState<
    UploadedPresentation | GeneratedPresentation | null
  >(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [generatedDeleteCandidate, setGeneratedDeleteCandidate] =
    useState<GeneratedPresentation | null>(null);
  const [clearGeneratedOpen, setClearGeneratedOpen] = useState(false);
  const [cleanupDuplicatesOpen, setCleanupDuplicatesOpen] = useState(false);
  const [cleanupDuplicatesPreview, setCleanupDuplicatesPreview] = useState<
    UploadedPresentation[]
  >([]);

  useEffect(() => {
    async function loadFiles() {
      setFilesLoading(true);
      try {
        const [loadedUploaded, loadedGenerated] = await Promise.all([
          cleanupUploadedPresentationsHistory(),
          cleanupGeneratedPresentationsHistory(),
        ]);
        setUploaded(loadedUploaded);
        setGenerated(loadedGenerated);
      } catch (error) {
        console.error("[PresentationCenter] Failed to load files", error);
        toast.error("Failed to load presentation files.");
      } finally {
        setFilesLoading(false);
      }
    }
    void loadFiles();
  }, []);

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
  const odmFacilityOptions = [
    ALL_FACILITIES_LABEL,
    ...(odmOptions.facilities.length ? odmOptions.facilities : []),
  ];
  const odmEquipmentTypeOptions = ["", ...odmOptions.equipmentTypes];
  const odmCategoryOptions = ["", ...odmOptions.categories];
  const odmInspectorOptions = ["", ...odmOptions.inspectors];
  const odmCanGenerate =
    Boolean(
      odmSelection.reportingYear &&
      odmSelection.reportingMonth &&
      odmSelection.facility &&
      odmSelection.template
    ) &&
    !odmOptionsLoading &&
    !odmOptionsError &&
    odmOptions.years.length > 0 &&
    odmOptions.months.length > 0;

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

  const sortedGenerated = useMemo(() => {
    return [...generated].sort((a, b) => {
      const aDate = a.generatedAt ?? a.generatedDate;
      const bDate = b.generatedAt ?? b.generatedDate;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
  }, [generated]);

  function closeUploadModals() {
    setUploadDeleteCandidate(null);
    setUploadRenameCandidate(null);
    setRenameValue("");
    setUploadReplaceCandidate(null);
    setReplaceKeepName(true);
    setUploadDetailCandidate(null);
  }

  function closeGeneratedModals() {
    setGeneratedDeleteCandidate(null);
    setGeneratedDetailCandidate(null);
    setClearGeneratedOpen(false);
  }

  function getUploadedFileUsage(deck: UploadedPresentation) {
    return generated.some(entry => entry.dataUrl === deck.dataUrl)
      ? "Used by at least one generated presentation."
      : "Not referenced by generated presentation history.";
  }

  async function confirmDeleteUploaded(deck: UploadedPresentation) {
    const next = await deleteUploadedPresentation(uploaded, deck.id);
    setUploaded(next);
    toast.success("Uploaded file removed.");
    closeUploadModals();
  }

  async function confirmDeleteGenerated(deck: GeneratedPresentation) {
    const next = await deleteGeneratedPresentation(generated, deck.id);
    setGenerated(next);
    toast.success("Generated presentation removed from history.");
    closeGeneratedModals();
  }

  async function confirmClearGeneratedHistory() {
    const next = await clearGeneratedPresentationsHistory();
    setGenerated(next);
    toast.success("Generated presentation history cleared. Uploaded files are untouched.");
    closeGeneratedModals();
  }

  async function handleRenameSubmit() {
    if (!uploadRenameCandidate) return;
    const result = await renameUploadedPresentation(
      uploaded,
      uploadRenameCandidate.id,
      renameValue
    );
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setUploaded(result.items);
    toast.success("File renamed.");
    closeUploadModals();
  }

  async function handleReplaceFileList(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !uploadReplaceCandidate) return;
    const result = await replaceUploadedPresentation(
      uploaded,
      uploadReplaceCandidate.id,
      file,
      replaceKeepName
    );
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setUploaded(result.items);
    toast.success("File replaced.");
    if (replaceInputRef.current) replaceInputRef.current.value = "";
    closeUploadModals();
  }

  function openCleanupDuplicatesPreview() {
    const sorted = [...uploaded].sort(
      (a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
    );
    const seen = new Set<string>();
    const duplicates: UploadedPresentation[] = [];
    for (const deck of sorted) {
      const key = [deck.name, deck.category].join("::");
      if (seen.has(key)) {
        duplicates.push(deck);
      } else {
        seen.add(key);
      }
    }
    setCleanupDuplicatesPreview(duplicates);
    setCleanupDuplicatesOpen(true);
  }

  function confirmCleanupDuplicates() {
    const keep = new Set(uploaded.map(deck => deck.id));
    for (const removed of cleanupDuplicatesPreview) {
      keep.delete(removed.id);
    }
    const next = uploaded.filter(deck => keep.has(deck.id));
    setUploaded(next);
    toast.success(`Removed ${cleanupDuplicatesPreview.length} duplicate library entries.`);
    setCleanupDuplicatesOpen(false);
    setCleanupDuplicatesPreview([]);
  }

  async function handleUpload(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const result = await createUploadedPresentation(file, {
        category,
        uploadedBy: "ODM User",
      });
      if (result.error || !result.deck) {
        toast.error(result.error ?? "Upload failed.");
        return;
      }
      const next = [result.deck, ...uploaded];
      setUploaded(next);
      toast.success("Presentation uploaded successfully.");
    } catch (error) {
      console.error("[PresentationCenter] Upload failed", error);
      const message =
        error instanceof Error ? error.message : "Upload failed. Please try again with a valid .pptx file.";
      toast.error(message);
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
          "No Monthly KPI data available for the selected reporting period."
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

  async function openOdmDialog(generatorId: string) {
    setOdmDialogGeneratorId(generatorId);
    setOdmDialogOpen(true);
    setOdmOptionsLoading(true);
    setOdmOptionsError(null);
    try {
      const options = await getAvailableOdmScorecardOptions();
      setOdmOptions(options);
      if (options.years.length === 0 || options.months.length === 0) {
        setOdmSelection(defaultOdmSelection);
        setOdmOptionsError(
          "No persisted Operator-Driven Maintenance records are available for presentation generation."
        );
        return;
      }
      setOdmSelection(previous => {
        const previousYear = Number(previous.reportingYear);
        const previousMonth = Number(previous.reportingMonth);
        const selectedYear = options.years.includes(previousYear)
          ? previousYear
          : options.years[0];
        const selectedMonth = options.months.includes(previousMonth)
          ? previousMonth
          : options.months[0];
        const facility =
          previous.facility !== ALL_FACILITIES_LABEL &&
          options.facilities.includes(previous.facility)
            ? previous.facility
            : ALL_FACILITIES_LABEL;
        return {
          reportingYear: String(selectedYear),
          reportingMonth: String(selectedMonth),
          dateFrom: previous.dateFrom,
          dateTo: previous.dateTo,
          facility,
          equipmentType: options.equipmentTypes.includes(previous.equipmentType)
            ? previous.equipmentType
            : "",
          category: options.categories.includes(previous.category)
            ? previous.category
            : "",
          inspector: options.inspectors.includes(previous.inspector)
            ? previous.inspector
            : "",
          template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
        };
      });
    } catch (error) {
      console.error("[PresentationCenter] ODM options failed", error);
      setOdmOptions(emptyOdmOptions);
      setOdmSelection(defaultOdmSelection);
      setOdmOptionsError(
        "Unable to load persisted Operator-Driven Maintenance records. Please try again."
      );
      toast.error("Unable to load Operator-Driven Maintenance generation options.");
    } finally {
      setOdmOptionsLoading(false);
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
      // For Governance generator, fetch data first
      let extraOptions = {};
      if (generatorId === "om-manual-governance") {
        const today = new Date().toISOString().split("T")[0];
        const response = await fetchGovernancePresentationData(today);
        extraOptions = { facilities: response.facilities };
      }
      
      const deck = await generator.generate({
        generatedBy: "ODM User",
        ...generationContext,
        ...extraOptions,
      });
      const next = mergeGeneratedPresentation(generated, deck);
      setGenerated(next);
      await saveGeneratedPresentations(next);
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

  async function handleOdmGenerate() {
    if (!odmDialogGeneratorId) return;
    const reportingYear = Number(odmSelection.reportingYear);
    const reportingMonth = Number(odmSelection.reportingMonth);
    if (!Number.isInteger(reportingYear) || !Number.isInteger(reportingMonth)) {
      toast.error("Select a valid reporting year and month.");
      return;
    }
    const generatedDeck = await runGenerator(odmDialogGeneratorId, {
      reportingYear,
      reportingMonth,
      dateFrom: odmSelection.dateFrom,
      dateTo: odmSelection.dateTo,
      facility: odmSelection.facility,
      equipmentType: odmSelection.equipmentType,
      category: odmSelection.category,
      inspector: odmSelection.inspector,
      template: odmSelection.template,
    });
    if (generatedDeck) {
      setOdmDialogOpen(false);
      setOdmDialogGeneratorId(null);
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
        {monthlyKpiAcceptanceMode && (
          <div
            role="status"
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          >
            Local Monthly KPI UI acceptance data is active. No production data
            will be read or changed.
          </div>
        )}
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
                  {filesLoading ? "…" : uploaded.length}
                </div>
                <div className="text-xs text-slate-600">Uploaded</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-[#005BAC]">
                  {filesLoading ? "…" : generated.length}
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
                <FileText className="h-5 w-5 text-[#005BAC]" /> Uploaded Files /
                Deck Library
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Manage uploaded .pptx files. Download, rename, replace, delete,
                or clean up duplicate library entries.
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
            <button
              type="button"
              onClick={() => openCleanupDuplicatesPreview()}
              disabled={isUploading || uploaded.length < 2}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#D6DFE8] px-4 text-sm font-semibold text-[#005BAC] transition hover:bg-[#EEF6FF] disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Clean Up Duplicates
            </button>
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-[#E2E8F0]">
            <table className="min-w-full divide-y divide-[#E2E8F0] text-sm">
              <thead className="bg-[#F1F5F9] text-left text-xs font-bold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">File Name</th>
                  <th className="px-4 py-3">File Type</th>
                  <th className="px-4 py-3">Uploaded Date</th>
                  <th className="px-4 py-3">Uploaded By</th>
                  <th className="px-4 py-3">File Size</th>
                  <th className="px-4 py-3">Used For / Generator</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] bg-white">
                {filteredUploaded.map(deck => (
                  <tr key={deck.id}>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => {
                          setViewerDeck(deck);
                          setViewerOpen(true);
                        }}
                        className="font-semibold text-[#0B1D44] hover:text-[#005BAC] hover:underline"
                        title="View slides"
                      >
                        {deck.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="rounded-full bg-[#DBEAFE] px-2.5 py-1 text-xs font-semibold text-[#005BAC]">
                        {deck.category}
                      </span>
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
                    <td className="px-4 py-3 text-slate-600">
                      {getUploadedFileUsage(deck)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-1.5 min-w-[16rem]">
                        <button
                          onClick={() => {
                            setViewerDeck(deck);
                            setViewerOpen(true);
                          }}
                          className="col-span-1 inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-[#D6DFE8] bg-white px-2 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                          title="View slides"
                        >
                          <Play className="h-3.5 w-3.5" /> View Slides
                        </button>
                        <button
                          onClick={() => downloadDataUrl(deck.dataUrl, deck.name)}
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-[#D6DFE8] bg-white px-2 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </button>
                        <button
                          onClick={() => setUploadDetailCandidate(deck)}
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-[#D6DFE8] bg-white px-2 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                          title="View Details"
                        >
                          <Eye className="h-3.5 w-3.5" /> Details
                        </button>
                        <button
                          onClick={() => {
                            setViewerDeck(deck);
                            setViewerOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6DFE8] px-3 py-1.5 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                          title="View slides"
                        >
                          <Play className="h-3.5 w-3.5" /> View Slides
                        </button>
                        <button
                          onClick={() => {
                            setUploadRenameCandidate(deck);
                            setRenameValue(deck.name);
                          }}
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-[#D6DFE8] bg-white px-2 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                          title="Rename"
                        >
                          <Edit3 className="h-3.5 w-3.5" /> Rename
                        </button>
                        <button
                          onClick={() => {
                            setUploadReplaceCandidate(deck);
                            setReplaceKeepName(true);
                            setTimeout(() => replaceInputRef.current?.click(), 0);
                          }}
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-[#D6DFE8] bg-white px-2 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                          title="Replace"
                        >
                          <Replace className="h-3.5 w-3.5" /> Replace
                        </button>
                        <button
                          onClick={() => setUploadDeleteCandidate(deck)}
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-red-200 bg-white px-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUploaded.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-sm text-slate-500"
                    >
                      No uploaded files yet. Use Upload Deck to add a .pptx file.
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
	                        isMonthlyKpiGenerator(generator.id)
                          ? void openMonthlyKpiDialog(generator.id)
	                          : generator.id ===
	                              operatorDrivenMaintenanceGeneratorId
	                            ? void openOdmDialog(generator.id)
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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#0B1D44]">
                Recent Generated Presentations
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                PPTX files created by generators. Download, view details, or clear
                history. Uploaded files are not affected.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setClearGeneratedOpen(true)}
              disabled={generated.length === 0}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Clear Generated History
            </button>
          </div>
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
                {sortedGenerated.map(deck => (
                  <tr key={deck.id}>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => {
                          setViewerDeck(deck);
                          setViewerOpen(true);
                        }}
                        className="font-semibold text-[#0B1D44] hover:text-[#005BAC] hover:underline"
                        title="View slides"
                      >
                        {deck.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{deck.type}</div>
                      {deck.reportingYear && deck.reportingMonth && (
                        <div className="mt-1 text-xs text-slate-500">
                          {formatReportingPeriod(
                            deck.reportingMonth,
                            deck.reportingYear
                          )}{" "}
	                          •{" "}
	                          {deck.businessUnit ||
	                            deck.facility ||
	                            ALL_BUSINESS_UNITS_LABEL}
                        </div>
                      )}
                      {(deck.dateFrom || deck.dateTo) && (
                        <div className="mt-1 text-xs text-slate-500">
                          {deck.dateFrom && deck.dateTo
                            ? `${deck.dateFrom} to ${deck.dateTo}`
                            : deck.dateFrom
                              ? `From ${deck.dateFrom}`
                              : `Through ${deck.dateTo}`}
                        </div>
                      )}
                      {(deck.equipmentType || deck.category || deck.inspector) && (
                        <div className="mt-1 text-xs text-slate-500">
                          {[deck.equipmentType, deck.category, deck.inspector]
                            .filter(Boolean)
                            .join(" • ")}
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
                    <td className="px-3 py-2">
                      <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-1.5 min-w-[16rem]">
                        <button
                          onClick={() => {
                            setViewerDeck(deck);
                            setViewerOpen(true);
                          }}
                          className="col-span-1 inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-[#D6DFE8] bg-white px-2 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                          title="View slides"
                        >
                          <Play className="h-3.5 w-3.5" /> View Slides
                        </button>
                        <button
                          onClick={() => downloadDataUrl(deck.dataUrl, deck.name)}
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-[#D6DFE8] bg-white px-2 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                          title="Download latest file"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </button>
                        <button
                          onClick={() => {
                            setViewerDeck(deck);
                            setViewerOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6DFE8] px-3 py-1.5 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                          title="View slides"
                        >
                          <Play className="h-3.5 w-3.5" /> View Slides
                        </button>
                        <button
                          onClick={() => setGeneratedDetailCandidate(deck)}
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-[#D6DFE8] bg-white px-2 text-xs font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
                          title="View details"
                        >
                          <Eye className="h-3.5 w-3.5" /> Details
                        </button>
                        <div aria-hidden="true" />
                        <div aria-hidden="true" />
                        <button
                          onClick={() => setGeneratedDeleteCandidate(deck)}
                          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-red-200 bg-white px-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                          title="Delete history entry"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {generated.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-sm text-slate-500"
                    >
                      No generated presentations yet. Generate a Monthly KPI
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

      {odmDialogOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="odm-pptx-title"
            className="w-full max-w-2xl rounded-xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-5 py-4">
              <div>
                <h2
                  id="odm-pptx-title"
                  className="text-lg font-bold text-[#0B1D44]"
                >
                  Generate Operator-Driven Maintenance PPTX
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Select persisted inspection records for the Executive Summary
                  scorecard deck.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setOdmDialogOpen(false);
                  setOdmDialogGeneratorId(null);
                }}
                disabled={activeGeneratorId === odmDialogGeneratorId}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#D6DFE8] text-slate-600 hover:bg-[#F8FAFC] disabled:opacity-60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              {odmOptionsLoading && (
                <div className="flex items-center gap-2 rounded-lg border border-[#D6DFE8] bg-[#F8FBFF] px-3 py-2 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin text-[#005BAC]" />
                  Loading persisted Operator-Driven Maintenance records...
                </div>
              )}

              {odmOptionsError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {odmOptionsError}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-[#0B1D44]">
                  Reporting Year
                  <select
                    value={odmSelection.reportingYear}
                    onChange={event => {
                      const reportingYear = event.target.value;
                      setOdmSelection(previous => ({
                        ...previous,
                        reportingYear,
                        ...getOdmSelectionDateRange(
                          reportingYear,
                          previous.reportingMonth
                        ),
                      }));
                    }}
                    disabled={
                      odmOptionsLoading || odmOptions.years.length === 0
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {odmOptions.years.length ? (
                      odmOptions.years.map(year => (
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
                    value={odmSelection.reportingMonth}
                    onChange={event => {
                      const reportingMonth = event.target.value;
                      setOdmSelection(previous => ({
                        ...previous,
                        reportingMonth,
                        ...getOdmSelectionDateRange(
                          previous.reportingYear,
                          reportingMonth
                        ),
                      }));
                    }}
                    disabled={
                      odmOptionsLoading || odmOptions.months.length === 0
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {odmOptions.months.length ? (
                      odmOptions.months.map(month => (
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
                  Date From
                  <input
                    type="date"
                    value={odmSelection.dateFrom}
                    onChange={event =>
                      setOdmSelection(previous => ({
                        ...previous,
                        dateFrom: event.target.value,
                      }))
                    }
                    disabled={odmOptionsLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  />
                </label>

                <label className="text-sm font-semibold text-[#0B1D44]">
                  Date To
                  <input
                    type="date"
                    value={odmSelection.dateTo}
                    onChange={event =>
                      setOdmSelection(previous => ({
                        ...previous,
                        dateTo: event.target.value,
                      }))
                    }
                    disabled={odmOptionsLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  />
                </label>

                <label className="text-sm font-semibold text-[#0B1D44]">
                  Plant / Facility
                  <select
                    value={odmSelection.facility}
                    onChange={event =>
                      setOdmSelection(previous => ({
                        ...previous,
                        facility: event.target.value,
                      }))
                    }
                    disabled={odmOptionsLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {odmFacilityOptions.map(facility => (
                      <option key={facility} value={facility}>
                        {facility}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-[#0B1D44]">
                  Equipment Type
                  <select
                    value={odmSelection.equipmentType}
                    onChange={event =>
                      setOdmSelection(previous => ({
                        ...previous,
                        equipmentType: event.target.value,
                      }))
                    }
                    disabled={odmOptionsLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {odmEquipmentTypeOptions.map(equipmentType => (
                      <option key={equipmentType || "all"} value={equipmentType}>
                        {equipmentType || "All Equipment Types"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-[#0B1D44]">
                  Category
                  <select
                    value={odmSelection.category}
                    onChange={event =>
                      setOdmSelection(previous => ({
                        ...previous,
                        category: event.target.value,
                      }))
                    }
                    disabled={odmOptionsLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {odmCategoryOptions.map(category => (
                      <option key={category || "all"} value={category}>
                        {category || "All Categories"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-[#0B1D44]">
                  Inspector
                  <select
                    value={odmSelection.inspector}
                    onChange={event =>
                      setOdmSelection(previous => ({
                        ...previous,
                        inspector: event.target.value,
                      }))
                    }
                    disabled={odmOptionsLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {odmInspectorOptions.map(inspector => (
                      <option key={inspector || "all"} value={inspector}>
                        {inspector || "All Inspectors"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-[#0B1D44]">
                  Template
                  <select
                    value={odmSelection.template}
                    onChange={event =>
                      setOdmSelection(previous => ({
                        ...previous,
                        template: event.target.value as OdmTemplate,
                      }))
                    }
                    disabled={odmOptionsLoading}
                    className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC] disabled:bg-slate-100"
                  >
                    {ODM_TEMPLATE_OPTIONS.map(template => (
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
                  setOdmDialogOpen(false);
                  setOdmDialogGeneratorId(null);
                }}
                disabled={activeGeneratorId === odmDialogGeneratorId}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D6DFE8] px-4 text-sm font-semibold text-[#005BAC] hover:bg-[#EEF6FF] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleOdmGenerate()}
                disabled={
                  !odmCanGenerate || activeGeneratorId === odmDialogGeneratorId
                }
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#005BAC] px-4 text-sm font-semibold text-white hover:bg-[#004A8F] disabled:opacity-60"
              >
                {activeGeneratorId === odmDialogGeneratorId && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Generate PPTX
              </button>
            </div>
          </div>
        </div>

      )}
      {uploadDeleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-[#0B1D44]">Delete Uploaded File</h3>
            <p className="mt-2 text-sm text-slate-600">
              Are you sure you want to delete this uploaded file?
            </p>
            <div className="mt-4 space-y-2 rounded-lg bg-[#F8FAFC] p-3 text-sm">
              <div>
                <span className="font-semibold">File name:</span> {uploadDeleteCandidate.name}
              </div>
              <div>
                <span className="font-semibold">File type:</span> {uploadDeleteCandidate.category}
              </div>
              <div>
                <span className="font-semibold">Uploaded:</span>{" "}
                {formatDate(uploadDeleteCandidate.uploadDate)}
              </div>
              <div>
                <span className="font-semibold">Usage:</span>{" "}
                {getUploadedFileUsage(uploadDeleteCandidate)}
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-semibold">What will be removed:</span> this uploaded file entry and its stored data payload.
            </p>
            <p className="mt-1 text-sm text-slate-600">
              <span className="font-semibold">What will NOT be removed:</span> any generated presentation history entries or other uploaded files.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setUploadDeleteCandidate(null)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D6DFE8] px-4 text-sm font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmDeleteUploaded(uploadDeleteCandidate)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
              >
                <Trash2 className="h-4 w-4" /> Delete File
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadRenameCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-[#0B1D44]">Rename Uploaded File</h3>
            <label className="mt-4 block text-sm font-semibold text-[#0B1D44]">
              File name
              <input
                value={renameValue}
                onChange={event => setRenameValue(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-[#D6DFE8] px-3 text-sm font-normal text-slate-700 outline-none focus:border-[#005BAC]"
                placeholder="file.pptx"
              />
            </label>
            <p className="mt-2 text-xs text-slate-500">
              Name must not be blank, must keep the .pptx extension, and cannot contain paths.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => closeUploadModals()}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D6DFE8] px-4 text-sm font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRenameSubmit()}
                disabled={!renameValue.trim()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#005BAC] px-4 text-sm font-semibold text-white hover:bg-[#004A8F] disabled:opacity-60"
              >
                <Edit3 className="h-4 w-4" /> Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadReplaceCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-[#0B1D44]">Replace Uploaded File</h3>
            <p className="mt-2 text-sm text-slate-600">
              Choose a new .pptx file for{" "}
              <span className="font-semibold">{uploadReplaceCandidate.name}</span>.
            </p>
            <input
              ref={replaceInputRef}
              type="file"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              onChange={event => void handleReplaceFileList(event.target.files)}
              className="hidden"
            />
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={replaceKeepName}
                onChange={event => setReplaceKeepName(event.target.checked)}
                className="h-4 w-4 rounded border-[#D6DFE8] text-[#005BAC] focus:ring-[#005BAC]"
              />
              Keep current file name
            </label>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  if (replaceInputRef.current) replaceInputRef.current.value = "";
                  closeUploadModals();
                }}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D6DFE8] px-4 text-sm font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => replaceInputRef.current?.click()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#005BAC] px-4 text-sm font-semibold text-white hover:bg-[#004A8F]"
              >
                <Replace className="h-4 w-4" /> Choose Replacement
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadDetailCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold text-[#0B1D44]">File Details</h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setUploadDetailCandidate(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#D6DFE8] text-slate-600 hover:bg-[#F8FAFC]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div>
                <span className="font-semibold text-slate-600">File name:</span>{" "}
                {uploadDetailCandidate.name}
              </div>
              <div>
                <span className="font-semibold text-slate-600">File type:</span>{" "}
                {uploadDetailCandidate.category}
              </div>
              <div>
                <span className="font-semibold text-slate-600">Uploaded:</span>{" "}
                {formatDate(uploadDetailCandidate.uploadDate)}
              </div>
              <div>
                <span className="font-semibold text-slate-600">Uploaded by:</span>{" "}
                {uploadDetailCandidate.uploadedBy}
              </div>
              <div>
                <span className="font-semibold text-slate-600">File size:</span>{" "}
                {formatBytes(uploadDetailCandidate.size)}
              </div>
              <div>
                <span className="font-semibold text-slate-600">Usage:</span>{" "}
                {getUploadedFileUsage(uploadDetailCandidate)}
              </div>
            </div>
          </div>
        </div>
      )}

      {generatedDeleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-[#0B1D44]">Delete Generated Presentation</h3>
            <p className="mt-2 text-sm text-slate-600">
              Remove this generated presentation from recent history?
            </p>
            <div className="mt-4 rounded-lg bg-[#F8FAFC] p-3 text-sm">
              <div>
                <span className="font-semibold">Name:</span> {generatedDeleteCandidate.name}
              </div>
              <div>
                <span className="font-semibold">Type:</span> {generatedDeleteCandidate.type}
              </div>
              <div>
                <span className="font-semibold">Generated:</span>{" "}
                {formatDate(generatedDeleteCandidate.generatedDate)}
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-semibold">What will NOT be removed:</span> uploaded files and other generated presentations.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setGeneratedDeleteCandidate(null)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D6DFE8] px-4 text-sm font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmDeleteGenerated(generatedDeleteCandidate)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
              >
                <Trash2 className="h-4 w-4" /> Delete Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {generatedDetailCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold text-[#0B1D44]">Generated Presentation Details</h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setGeneratedDetailCandidate(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#D6DFE8] text-slate-600 hover:bg-[#F8FAFC]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div>
                <span className="font-semibold text-slate-600">Name:</span>{" "}
                {generatedDetailCandidate.name}
              </div>
              <div>
                <span className="font-semibold text-slate-600">Type:</span>{" "}
                {generatedDetailCandidate.type}
              </div>
              <div>
                <span className="font-semibold text-slate-600">Generated:</span>{" "}
                {formatDate(generatedDetailCandidate.generatedDate)}
              </div>
              <div>
                <span className="font-semibold text-slate-600">Generated by:</span>{" "}
                {generatedDetailCandidate.generatedBy}
              </div>
              <div>
                <span className="font-semibold text-slate-600">Size:</span>{" "}
                {formatBytes(generatedDetailCandidate.size)}
              </div>
              {generatedDetailCandidate.generatorName && (
                <div>
                  <span className="font-semibold text-slate-600">Generator:</span>{" "}
                  {generatedDetailCandidate.generatorName}
                </div>
              )}
              {generatedDetailCandidate.template && (
                <div>
                  <span className="font-semibold text-slate-600">Template:</span>{" "}
                  {generatedDetailCandidate.template}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {clearGeneratedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-[#0B1D44]">Clear Generated History</h3>
            <p className="mt-2 text-sm text-slate-600">
              This will remove all {generated.length} generated presentation history entries.
            </p>
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-semibold">What will be removed:</span> all generated PPTX history rows.
            </p>
            <p className="mt-1 text-sm text-slate-600">
              <span className="font-semibold">What will NOT be removed:</span> uploaded files in the Deck Library.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setClearGeneratedOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D6DFE8] px-4 text-sm font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmClearGeneratedHistory()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
              >
                <Trash2 className="h-4 w-4" /> Clear History
              </button>
            </div>
          </div>
        </div>
      )}

      {cleanupDuplicatesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-[#0B1D44]">Clean Up Duplicate Uploads</h3>
            <p className="mt-2 text-sm text-slate-600">
              This is a dry-run preview of duplicate uploaded file entries that will be removed, keeping the newest copy.
            </p>
            {cleanupDuplicatesPreview.length === 0 ? (
              <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                No duplicate uploaded files found.
              </p>
            ) : (
              <div className="mt-4 max-h-64 overflow-auto rounded-lg border border-[#E2E8F0]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#F1F5F9] text-left text-xs font-bold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-4 py-2">File Name</th>
                      <th className="px-4 py-2">Uploaded Date</th>
                      <th className="px-4 py-2">File Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {cleanupDuplicatesPreview.map(deck => (
                      <tr key={deck.id}>
                        <td className="px-4 py-2">{deck.name}</td>
                        <td className="px-4 py-2">{formatDate(deck.uploadDate)}</td>
                        <td className="px-4 py-2">{formatBytes(deck.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-semibold">What will NOT be removed:</span> the newest copy of each duplicate group, and any generated presentation history.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setCleanupDuplicatesOpen(false);
                  setCleanupDuplicatesPreview([]);
                }}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D6DFE8] px-4 text-sm font-semibold text-[#005BAC] hover:bg-[#EEF6FF]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmCleanupDuplicates()}
                disabled={cleanupDuplicatesPreview.length === 0}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" /> Confirm Cleanup
              </button>
            </div>
          </div>
        </div>
      )}

      {viewerOpen && viewerDeck && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950">
          <PptxViewer
            fileUrl={viewerDeck.dataUrl}
            fileName={viewerDeck.name}
            title={viewerDeck.title || viewerDeck.name}
            onClose={() => {
              setViewerOpen(false);
              setViewerDeck(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
