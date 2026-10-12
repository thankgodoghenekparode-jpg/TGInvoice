import { Link } from 'react-router-dom';
import { FileQuestion, ArrowLeft } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
      <p className="text-7xl font-black tracking-tight text-brand-600">404</p>
      <FileQuestion className="mt-4 size-10 text-slate-300" />
      <h1 className="mt-4 text-xl font-semibold text-slate-900">This page doesn’t exist</h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        The link may be out of date, or the document was deleted. Everything important lives in the sidebar.
      </p>
      <Link to="/dashboard" className="btn btn-primary btn-sm mt-6">
        <ArrowLeft size={15} /> Back to dashboard
      </Link>
    </div>
  );
}
