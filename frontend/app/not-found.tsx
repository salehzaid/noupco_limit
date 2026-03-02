import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold text-gray-800 mb-2">404</h1>
      <p className="text-gray-600 mb-6">هذه الصفحة غير موجودة</p>
      <div className="flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:gap-4">
        <Link
          href="/"
          className="rounded bg-gray-200 px-4 py-2 text-center text-gray-800 hover:bg-gray-300"
        >
          الرئيسية
        </Link>
        <Link
          href="/hospitals/1/departments"
          className="rounded bg-blue-600 px-4 py-2 text-center text-white hover:bg-blue-700"
        >
          إدارة حدود الأقسام
        </Link>
      </div>
    </main>
  );
}
