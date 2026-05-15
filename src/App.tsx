import { Routes, Route } from 'react-router'
import { useEffect } from 'react'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import Login from "./pages/Login"
import Help from "./pages/Help"
import NotFound from "./pages/NotFound"
import GanttPlanner from "./pages/GanttPlanner"
import ExistingFacilitiesMaintenance from "./pages/ExistingFacilitiesMaintenance"
import SmpDashboard from "./pages/SmpDashboard"
import OmManualsLibrary from "./pages/OmManualsLibrary"
import ScorecardDashboard from "./pages/ScorecardDashboard"

/* Full-page redirect to Hono-served HTML dashboard */
function OdmRedirect() {
  useEffect(() => { window.location.href = '/mw-dashboard'; }, []);
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, fontFamily: 'Inter, sans-serif', color: '#5A6B7D' }}>
      <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTop: '3px solid #005BAC', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <span style={{ fontSize: 13 }}>Loading Operator-Driven Maintenance...</span>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/equipment" element={<Dashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/help" element={<Help />} />
      <Route path="/gantt-planner" element={<GanttPlanner />} />
      <Route path="/existing-facilities" element={<ExistingFacilitiesMaintenance />} />
      <Route path="/smp-dashboard" element={<SmpDashboard />} />
      <Route path="/om-manuals-library" element={<OmManualsLibrary />} />
      <Route path="/scorecard-kpi" element={<ScorecardDashboard />} />
      <Route path="/operator-maintenance" element={<OdmRedirect />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
