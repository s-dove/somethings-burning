import { Link } from "../components/common/Link";
import { Layout } from "../components/Layout";

export function NotFoundPage() {
  return (
    <Layout>
      <div className="px-6 py-14 text-center text-cinder">
        <strong className="mb-1 block text-base text-soot">Page not found</strong>
        <Link to="/">Back to all issues</Link>
      </div>
    </Layout>
  );
}
