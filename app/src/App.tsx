import { Routes, Route } from 'react-router';
import Layout from './components/Layout';
import Home from './pages/Home';
import LessonPath from './pages/LessonPath';
import Repos from './pages/Repos';
import Repository from './pages/Repository';
import RepoBuilder from './pages/RepoBuilder';
import Users from './pages/Users';
import UserProfile from './pages/UserProfile';
import Slides from './pages/Slides';
import Gallery from './pages/Gallery';
import SlideTool from './pages/SlideTool';
import ManualSlideBuilder from './pages/ManualSlideBuilder';
import ManualSlidePlay from './pages/ManualSlidePlay';
import Templates from './pages/Templates';
import Runs from './pages/Runs';
import Replay from './pages/Replay';
import PresetPlay from './pages/PresetPlay';
import PresetEditor from './pages/PresetEditor';
import MyCustomizationPlay from './pages/MyCustomizationPlay';
import About from './pages/About';
import Feed from './pages/Feed';
import Post from './pages/Post';
import Settings from './pages/Settings';
import Auth from './pages/Auth';
import AdminDashboard from './pages/AdminDashboard';
import AdminStats from './pages/AdminStats';
import AdminControls from './pages/AdminControls';
import AdminProjects from './pages/AdminProjects';
import AdminFinance from './pages/AdminFinance';
import AdminMarketing from './pages/AdminMarketing';
import AdminMarketingCard from './pages/AdminMarketingCard';
import AdminAnalytics from './pages/AdminAnalytics';
import AdminPayments from './pages/AdminPayments';
import AdminFlags from './pages/AdminFlags';
import AdminUsers from './pages/AdminUsers';
import AdminModerators from './pages/AdminModerators';
import AdminSettings from './pages/AdminSettings';
import AdminGate from './components/admin/AdminGate';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* The feed is the front door; the shelf is one step in. */}
        <Route path="/" element={<Feed />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/feed/:slug" element={<Post />} />
        <Route path="/chat" element={<Home />} />
        <Route path="/lesson-path" element={<LessonPath />} />
        <Route path="/repos" element={<Repos />} />
        <Route path="/repos/new/manual" element={<RepoBuilder />} />
        <Route path="/repos/:slug" element={<Repository />} />
        <Route path="/users" element={<Users />} />
        <Route path="/users/:id" element={<UserProfile />} />
        <Route path="/repos/:slug/play/:seq" element={<PresetPlay />} />
        <Route path="/repos/:slug/play/:seq/edit" element={<PresetEditor />} />
        <Route path="/repos/:slug/play/:seq/mine" element={<MyCustomizationPlay />} />
        <Route path="/slides" element={<Slides />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/slides/build" element={<ManualSlideBuilder />} />
        <Route path="/slides/build/:slug" element={<ManualSlideBuilder />} />
        <Route path="/slides/show/:slug" element={<ManualSlidePlay />} />
        <Route path="/slides/:slug" element={<SlideTool />} />
        {/* Slide templates are an admin-only management surface */}
        <Route
          path="/templates"
          element={
            <AdminGate minRole="admin">
              <Templates />
            </AdminGate>
          }
        />
        <Route path="/runs" element={<Runs />} />
        <Route path="/runs/:runId/replay" element={<Replay />} />
        <Route path="/about" element={<About />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/stats" element={<AdminStats />} />
        <Route path="/admin/controls" element={<AdminControls />} />
        <Route path="/admin/projects" element={<AdminProjects />} />
        <Route path="/admin/projects/finance" element={<AdminFinance />} />
        <Route path="/admin/projects/marketing" element={<AdminMarketing />} />
        <Route path="/admin/projects/marketing/card" element={<AdminMarketingCard />} />
        <Route path="/admin/analytics" element={<AdminAnalytics />} />
        <Route path="/admin/payments" element={<AdminPayments />} />
        <Route path="/admin/flags" element={<AdminFlags />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/moderators" element={<AdminModerators />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="*" element={<Feed />} />
      </Route>
    </Routes>
  );
}
