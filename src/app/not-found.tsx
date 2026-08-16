import { Link } from "@/components/tab-link";
import { Compass, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft text-brand">
        <Compass className="h-7 w-7" />
      </span>
      <p className="mt-6 text-5xl font-extrabold tracking-tight text-ink">404</p>
      <h1 className="mt-2 text-xl font-bold text-ink">This stop is not on our route</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The page you are looking for has moved or never existed.
      </p>
      <div className="mt-6 flex gap-3">
        <Link href="/" className="btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <Link href="/search" className="btn-primary">
          Find a bus
        </Link>
      </div>
    </div>
  );
}
