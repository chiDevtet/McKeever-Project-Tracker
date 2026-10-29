import { PageHeader } from "@/components/page-header";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { requirePageViewer } from "@/server/next-session";
import { getSettings } from "@/server/services/workspace";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await requirePageViewer();
  const settings = await getSettings(viewer);
  return (
    <>
      <PageHeader title="Settings" description="Company branding, division planning defaults, workforce availability, and system status." />
      <SettingsWorkspace settings={settings} isAdmin={viewer.isAdmin} />
    </>
  );
}
