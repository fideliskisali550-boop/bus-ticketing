import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchBar } from "@/components/search-bar";
import { SearchResults } from "@/components/search-results";

export const metadata: Metadata = { title: "Find a bus" };

export default function SearchPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
        Find your bus
      </h1>
      <p className="mt-1 text-sm text-muted">
        Live availability across every scheduled departure.
      </p>

      <div className="mt-6">
        <Suspense>
          <SearchBar compact />
        </Suspense>
      </div>

      <Suspense>
        <SearchResults />
      </Suspense>
    </div>
  );
}
