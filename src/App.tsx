import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import Login from "./pages/Login"
import Help from "./pages/Help"
import NotFound from "./pages/NotFound"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/equipment" element={<Dashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/help" element={<Help />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
