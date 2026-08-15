import { ADD_ONS, PET_SURCHARGE_CENTS } from "@/lib/pricing";
import { formatCents } from "@/lib/money";

export function AddOnList({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <dl className="grid gap-x-12 sm:grid-cols-2">
        {ADD_ONS.map((a) => (
          <div
            key={a.code}
            className="flex items-baseline justify-between gap-4 border-b border-hairline py-4"
          >
            <dt className="text-body">
              {a.name}
              {!a.freePerkEligible && (
                <span className="ml-2 text-xs text-muted">(not eligible as the free perk)</span>
              )}
            </dt>
            <dd className="shrink-0 text-lg font-semibold text-accent">
              {formatCents(a.priceCents)}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-4">
          <dt className="text-body">
            Pet home surcharge
            <span className="ml-2 text-xs text-muted">(only if you have pets)</span>
          </dt>
          <dd className="shrink-0 text-lg font-semibold text-accent">
            {formatCents(PET_SURCHARGE_CENTS)}
            <span className="text-sm font-medium text-muted"> one-time</span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-4">
          <dt className="text-body">Bed linens changed</dt>
          <dd className="shrink-0 text-lg font-semibold text-accent">Included</dd>
        </div>
      </dl>
      <p className="mt-6 text-sm text-muted">
        Laundry is performed at the customer&apos;s own risk. See the service agreement.
      </p>
    </div>
  );
}
