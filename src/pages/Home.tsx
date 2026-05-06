import { Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a365d] via-[#1e3a5f] to-[#2c5282] text-white">
      <div className="max-w-5xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 bg-white/15 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6">
            ⚙️
          </div>
          <h1 className="text-4xl font-bold mb-3">Operations & Maintenance</h1>
          <p className="text-lg text-white/70">Multi-user dashboard suite — All changes sync across your team in real time</p>
          {isAuthenticated && user && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-white/80">
              <img src={user.avatar || undefined} alt="" className="w-8 h-8 rounded-full bg-white/20" />
              <span>Signed in as {user.name}</span>
            </div>
          )}
        </div>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Equipment Maintenance */}
          <Link
            to="/equipment"
            className="group bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-8 hover:bg-white/15 transition-all hover:scale-[1.02]"
          >
            <div className="w-12 h-12 bg-blue-500/30 rounded-xl flex items-center justify-center text-2xl mb-4">
              🔧
            </div>
            <h2 className="text-2xl font-bold mb-2">Equipment Maintenance</h2>
            <p className="text-white/70 mb-4">
              HTT STP &amp; Aglipay STP — 1,377 maintenance tasks across 128 equipment types.
              Track Operations, AMD, and ARD status with Edit/Save/Cancel workflow.
            </p>
            <div className="flex gap-2 mb-4">
              <span className="px-3 py-1 bg-white/10 rounded-full text-xs">976 HTT Tasks</span>
              <span className="px-3 py-1 bg-white/10 rounded-full text-xs">401 Aglipay Tasks</span>
            </div>
            <span className="text-blue-300 font-semibold group-hover:text-blue-200 flex items-center gap-1">
              Open Dashboard →
            </span>
          </Link>

          {/* OM Governance */}
          <Link
            to="/governance"
            className="group bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-8 hover:bg-white/15 transition-all hover:scale-[1.02]"
          >
            <div className="w-12 h-12 bg-orange-500/30 rounded-xl flex items-center justify-center text-2xl mb-4">
              📊
            </div>
            <h2 className="text-2xl font-bold mb-2">OM Governance</h2>
            <p className="text-white/70 mb-4">
              Track 4 facilities (AGLIPAY, HTT, EASTBAY, KAYSAKAT) through 9 milestones.
              S-Curve progress, deliverables, acceptance stages, and TOC-to-Annex mapping.
            </p>
            <div className="flex gap-2 mb-4">
              <span className="px-3 py-1 bg-white/10 rounded-full text-xs">4 Facilities</span>
              <span className="px-3 py-1 bg-white/10 rounded-full text-xs">9 Milestones</span>
              <span className="px-3 py-1 bg-white/10 rounded-full text-xs">14 TOC Items</span>
            </div>
            <span className="text-orange-300 font-semibold group-hover:text-orange-200 flex items-center gap-1">
              Open Dashboard →
            </span>
          </Link>
        </div>

        {/* Features */}
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div className="p-4">
            <div className="text-3xl mb-2">🔄</div>
            <div className="font-semibold">Real-Time Sync</div>
            <div className="text-sm text-white/60">All users see the same data</div>
          </div>
          <div className="p-4">
            <div className="text-3xl mb-2">🔐</div>
            <div className="font-semibold">OAuth Login</div>
            <div className="text-sm text-white/60">Secure user authentication</div>
          </div>
          <div className="p-4">
            <div className="text-3xl mb-2">📁</div>
            <div className="font-semibold">CSV Import/Export</div>
            <div className="text-sm text-white/60">Bulk data operations</div>
          </div>
          <div className="p-4">
            <div className="text-3xl mb-2">👥</div>
            <div className="font-semibold">Multi-User</div>
            <div className="text-sm text-white/60">Collaborative editing</div>
          </div>
        </div>
      </div>
    </div>
  );
}
