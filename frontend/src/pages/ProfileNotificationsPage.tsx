import { Link } from "../components/common/Link";
import { Layout } from "../components/Layout";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { useApi, type Session } from "../shared/api";
import { t } from "../shared/i18n";
import { ArrowLeft } from "../ui/icons";
import { ProfileDigest } from "./ProfileDigest";
import { ProfileNotifications } from "./ProfileNotifications";

/** How alerts that reach you are delivered, and the daily summary. */
export function ProfileNotificationsPage() {
  const { data, error } = useApi<Session>("/session");
  if (!data) {
    return <Layout nav="profile">{error ? <p role="alert" className="text-ember-ink">{error}</p> : <Loading />}</Layout>;
  }
  return (
    <Layout nav="profile">
      <PageHeader
        before={
          <Link to="/profile" className="inline-flex items-center gap-2 text-xs text-cinder no-underline">
            <ArrowLeft aria-hidden="true" />
            {t("Back to profile")}
          </Link>
        }
        title={t("Your notifications")}
        after={<p className="mt-2 text-sm text-cinder">{t("How alerts reach you, and the daily summary.")}</p>}
        spaceBelow="mb-2"
      />
      {data.user ? (
        <div className="max-w-[720px]">
          <ProfileDigest />
          <ProfileNotifications />
        </div>
      ) : (
        <p className="mt-8 text-sm text-cinder">{t("Sign in to see your profile.")}</p>
      )}
    </Layout>
  );
}
