import { Routes, Route } from "react-router";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Help from "./pages/Help";
import NotFound from "./pages/NotFound";
import GanttPlanner from "./pages/GanttPlanner";
import GanttProjectsDebug from "./pages/GanttProjectsDebug";
import ExistingFacilitiesMaintenance from "./pages/ExistingFacilitiesMaintenance";
import SmpDashboard from "./pages/SmpDashboard";
import OmManualsLibrary from "./pages/OmManualsLibrary";
import ScorecardDashboard from "./pages/ScorecardDashboard";
import PostPlanningInsights from "./pages/PostPlanningInsights";
import PresentationCenter from "./pages/PresentationCenter";
import OdmTalk from "./pages/OdmTalk";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/equipment" element={<Dashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/help" element={<Help />} />
      <Route path="/gantt-planner" element={<GanttPlanner />} />
      <Route
        path="/admin/gantt-projects-debug"
        element={<GanttProjectsDebug />}
      />
      <Route
        path="/existing-facilities"
        element={<ExistingFacilitiesMaintenance />}
      />
      <Route path="/smp-dashboard" element={<SmpDashboard />} />
      <Route path="/om-manuals-library" element={<OmManualsLibrary />} />
      <Route path="/scorecard-kpi" element={<ScorecardDashboard />} />
      <Route
        path="/post-planning-insights"
        element={<PostPlanningInsights />}
      />
      <Route path="/presentation-center" element={<PresentationCenter />} />
      <Route path="/odm-talk" element={<OdmTalk />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
