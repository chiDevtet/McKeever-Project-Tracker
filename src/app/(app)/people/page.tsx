import { PageHeader } from "@/components/page-header";
import { PeopleWorkspace } from "@/components/people/people-workspace";
import { canEdit } from "@/server/authz";
import { requirePageViewer } from "@/server/next-session";
import { listPeople } from "@/server/services/people";
import { listUsers } from "@/server/services/users";

export const metadata = { title: "People" };

export default async function PeoplePage() {
  const viewer = await requirePageViewer();
  const [people, users] = await Promise.all([listPeople(viewer), viewer.isAdmin ? listUsers(viewer) : null]);
  const canManagePeople = viewer.isAdmin || [...viewer.projectRoles.keys()].some((p) => canEdit(viewer, p));
  return (
    <>
      <PageHeader title="People" description="Personnel for leadership assignments, and (for administrators) user accounts and project access." />
      <PeopleWorkspace people={people} users={users} canManagePeople={canManagePeople} viewerId={viewer.userId} />
    </>
  );
}
