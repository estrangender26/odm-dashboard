import { Routes, Route } from "react-router";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Help from "./pages/Help";
import NotFound from "./pages/NotFound";
import GanttLandingPage from "./pages/GanttLandingPage";
import GanttNewProjectPage from "./pages/GanttNewProjectPage";
import PrimaveraLiteProjectPage from "./pages/PrimaveraLiteProjectPage";
import SmpDashboard from "./pages/SmpDashboard";
import OmManualsLibrary from "./pages/OmManualsLibrary";
import ScorecardDashboard from "./pages/ScorecardDashboard";
import PostPlanningInsights from "./pages/PostPlanningInsights";
import PresentationCenter from "./pages/PresentationCenter";
import ProjectsWithoutPPPMonitoringPage from "./pages/ProjectsWithoutPPPMonitoringPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/equipment" element={<Dashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/help" element={<Help />} />
      <Route path="/gantt" element={<GanttLandingPage />} />
      <Route path="/gantt/new" element={<GanttNewProjectPage />} />
      <Route path="/gantt/p/:slug" element={<PrimaveraLiteProjectPage />} />
      <Route path="/smp-dashboard" element={<SmpDashboard />} />
      <Route path="/om-manuals-library" element={<OmManualsLibrary />} />
      <Route path="/scorecard-kpi" element={<ScorecardDashboard />} />
      <Route
        path="/post-planning-insights"
        element={<PostPlanningInsights />}
      />
      <Route path="/presentation-center" element={<PresentationCenter />} />
      <Route path="/projects-without-ppp" element={<ProjectsWithoutPPPMonitoringPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
