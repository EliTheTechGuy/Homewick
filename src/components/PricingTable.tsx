import { formatCents } from "@/lib/money";
import { SERVICE_PRICES, SERVICE_TYPES, UNIT_SIZES } from "@/lib/pricing";

export function PricingTable({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <div className="overflow-x-auto rounded-2xl border border-hairline">
        <table className="w-full min-w-[34rem] border-collapse bg-white text-left">
          <thead>
            <tr className="bg-panel">
              <th className="px-6 py-4 text-sm font-semibold text-muted">Apartment size</th>
              {SERVICE_TYPES.map((s) => (
                <th key={s.id} className="px-6 py-4 text-sm font-semibold text-navy">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {UNIT_SIZES.map((size) => (
              <tr key={size.id} className="border-t border-hairline">
                <th scope="row" className="px-6 py-5 font-medium text-body">
                  {size.label}
                </th>
                {SERVICE_TYPES.map((s) => (
                  <td key={s.id} className="px-6 py-5 text-2xl font-semibold text-accent">
                    {formatCents(SERVICE_PRICES[size.id][s.id])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-5 text-sm leading-relaxed text-muted">
        Bed linens changed free with every clean. These are launch prices, and rates are reviewed
        annually with 30 days&apos; written notice. Houses are quoted separately by square
        footage.
      </p>
    </div>
  );
}
