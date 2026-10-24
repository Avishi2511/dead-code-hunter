import { Link, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import { CleanupPage } from "@/pages/CleanupPage";
import { Dashboard } from "@/pages/Dashboard";
import { FindingPage } from "@/pages/FindingPage";
import { Findings } from "@/pages/Findings";
import { GraphPage } from "@/pages/GraphPage";
import { Home } from "@/pages/Home";
import { ScanLayout } from "@/pages/ScanLayout";

function NotFound() {
  return (
    <div className="pt-10">
      <p className="text-muted">There's nothing here.</p>
      <Link to="/" className="mt-3 inline-block underline">
        Start a new hunt
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="scans/:id" element={<ScanLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="findings" element={<Findings />} />
          <Route path="findings/:fid" element={<FindingPage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="cleanup" element={<CleanupPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
