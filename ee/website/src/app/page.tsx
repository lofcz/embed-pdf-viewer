export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mx-auto max-w-2xl">
        <span className="border-primary-200 bg-primary-50 text-primary-700 inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium">
          Enterprise
        </span>

        <h1 className="mt-6 text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
          CloudPDF
        </h1>

        <p className="mt-6 text-lg leading-8 text-gray-600">
          The enterprise, self-hostable document engine behind EmbedPDF. Annotations, collaboration,
          versioning, and secure storage — built to run on your own infrastructure or ours.
        </p>

        <div className="mt-10 flex items-center justify-center gap-4">
          <a
            href="mailto:hello@cloudpdf.io"
            className="bg-primary-600 hover:bg-primary-700 rounded-md px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition"
          >
            Contact sales
          </a>
          <a
            href="https://www.embedpdf.com"
            className="hover:text-primary-700 text-sm font-semibold text-gray-900 transition"
          >
            View the open-source viewer <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </main>
  );
}
