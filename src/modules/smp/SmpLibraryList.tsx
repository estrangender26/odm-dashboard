import { legacyStatusBadge, revisionStatusBadge, formatSmpDate } from "./smpFormat";
import type { SmpDocumentListItem } from "./types";

export type SmpFilters = {
  family?: string;
  equipmentType?: string;
  facilityType?: string;
  criticality?: string;
  revision?: string;
  status?: string;
};

export type SmpFilterOptions = {
  families: string[];
  equipmentTypes: string[];
  facilityTypes: string[];
  criticalities: string[];
  revisions: string[];
  statuses: string[];
};

export function SmpLibraryList({
  items,
  availableFilters,
  search,
  filters,
  isLoading,
  selectedId,
  onSearch,
  onFilter,
  onClearFilters,
  onUploadClick,
  onSelect,
}: {
  items: SmpDocumentListItem[];
  availableFilters: SmpFilterOptions;
  search: string;
  filters: SmpFilters;
  isLoading: boolean;
  selectedId: number | null;
  onSearch: (value: string) => void;
  onFilter: (filters: SmpFilters) => void;
  onClearFilters: () => void;
  onUploadClick: () => void;
  onSelect: (item: SmpDocumentListItem) => void;
}) {
  const hasActiveFilters = Boolean(
    search || filters.family || filters.equipmentType || filters.facilityType ||
    filters.criticality || filters.revision || filters.status,
  );
  const activeCount = items.filter((d) => d.hasCurrentRevision || d.status === "Active").length;

  const select = (key: keyof SmpFilters) => (event: React.ChangeEvent<HTMLSelectElement>) =>
    onFilter({ ...filters, [key]: event.target.value || undefined });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex-shrink-0 p-3 border-b border-gray-200 space-y-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">&#128269;</span>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search reference no., title, SMP ID, family, asset, equipment, facility..."
            className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
          />
          {search && (
            <button onClick={() => onSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              &#10005;
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          <select value={filters.family || ""} onChange={select("family")} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
            <option value="">All Families</option>
            {availableFilters.families.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.equipmentType || ""} onChange={select("equipmentType")} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
            <option value="">All Equipment</option>
            {availableFilters.equipmentTypes.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.facilityType || ""} onChange={select("facilityType")} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
            <option value="">All Facility Types</option>
            {availableFilters.facilityTypes.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.criticality || ""} onChange={select("criticality")} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
            <option value="">All Criticality</option>
            {availableFilters.criticalities.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.revision || ""} onChange={select("revision")} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
            <option value="">All Revisions</option>
            {availableFilters.revisions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.status || ""} onChange={select("status")} className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
            <option value="">All Status</option>
            {availableFilters.statuses.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={onUploadClick}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 flex items-center gap-1"
          >
            📤 Upload SMP PDF
          </button>
          {hasActiveFilters && (
            <button onClick={onClearFilters} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100">
              Clear Search &amp; Filters
            </button>
          )}
        </div>
        {/* Real counts from persisted records only */}
        <div className="flex gap-3 text-xs text-gray-500">
          <span><strong className="text-gray-700">{items.length}</strong> shown</span>
          <span><strong className="text-green-600">{activeCount}</strong> current/active</span>
          <span className="ml-auto">{new Date().toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="text-center py-16 text-gray-400">
            <div className="relative w-8 h-8 mx-auto mb-3">
              <div className="absolute inset-0 rounded-full border-2 border-gray-200" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-600 animate-spin" />
            </div>
            <div className="text-sm font-semibold">Loading library...</div>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 px-6 text-gray-400">
            <div className="text-4xl mb-3">📂</div>
            {hasActiveFilters ? (
              <>
                <div className="text-sm font-semibold text-gray-600">No documents match your search</div>
                <div className="text-xs mt-1">Try adjusting or clearing the filters.</div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-gray-600">No SMP documents yet</div>
                <div className="text-xs mt-1 max-w-xs mx-auto">
                  Upload the first approved SMP PDF to build the controlled document library.
                </div>
                <button
                  onClick={onUploadClick}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
                >
                  📤 Upload Approved SMP PDF
                </button>
              </>
            )}
          </div>
        ) : (
          <div>
            {items.map((doc) => {
              const isSelected = selectedId === doc.id;
              const badge = doc.hasCurrentRevision
                ? revisionStatusBadge("current")
                : doc.revisionCount > 0
                  ? revisionStatusBadge("superseded")
                  : legacyStatusBadge(doc.status);
              return (
                <button
                  key={doc.id}
                  onClick={() => onSelect(doc)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 cursor-pointer transition hover:bg-gray-50 ${
                    isSelected ? "bg-blue-50 border-l-4 border-l-blue-600" : "border-l-4 border-l-transparent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[0.65rem] font-semibold text-gray-400 uppercase tracking-wide">
                        {doc.code}
                        {doc.revision ? ` · ${doc.revision}` : ""}
                        {doc.smpId ? ` · ${doc.smpId}` : ""}
                      </div>
                      <div className={`text-sm font-semibold mt-0.5 truncate ${isSelected ? "text-blue-800" : "text-gray-800"}`}>
                        {doc.title}
                      </div>
                    </div>
                    <span
                      className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                      style={{ background: badge.bg, color: badge.text }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500 flex-wrap">
                    {doc.smpFamily && <span className="text-indigo-600 font-medium">{doc.smpFamily}</span>}
                    {doc.equipmentType && <span>{doc.equipmentType}</span>}
                    {doc.facilityType && <span>· {doc.facilityType}</span>}
                    {doc.criticality && <span>· ABC {doc.criticality}</span>}
                    {doc.effectivityDate && <span>· Eff. {formatSmpDate(doc.effectivityDate)}</span>}
                    <span className="ml-auto text-gray-400">Updated {formatSmpDate(doc.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
