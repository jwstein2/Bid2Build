import type { ProposalDocument, ProposalSection } from "@/lib/proposal/types";
import { onColor, templateStyle } from "@/lib/proposal/templates";

/**
 * HTML rendering of the canonical ProposalDocument. It receives only customer-safe data, so it
 * cannot display internal costs even by mistake. The PDF renderer consumes the same document.
 */
export function ProposalView({ doc }: { doc: ProposalDocument }) {
  const st = templateStyle(doc.template);
  const brand = doc.brand.primaryColor;
  const accent = doc.brand.secondaryColor;
  const px = (pt: number) => `${(pt * 1.45).toFixed(1)}px`;
  const text = { fontSize: px(st.baseSize) };
  const headerDark = st.header === "band" || st.header === "dark";
  const headerBg = st.header === "dark" ? "#16202e" : st.header === "band" ? brand : "transparent";
  const headerFg = headerDark ? onColor(headerBg) : "#16202e";

  const logo =
    doc.brand.logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={doc.brand.logoUrl} alt={`${doc.brand.companyName} logo`} className="max-h-16 max-w-[180px] object-contain" />
    ) : null;

  return (
    <article className="mx-auto w-full max-w-[816px] bg-white text-[#16202e] shadow-sm ring-1 ring-black/10" style={text} aria-label="Proposal preview">
      {/* Header */}
      <header
        className={`px-[6%] ${st.compact ? "py-5" : "py-7"} ${doc.brand.logoLayout === "center" ? "text-center" : ""}`}
        style={{ background: headerBg, color: headerFg, borderBottom: st.header === "rule" ? `3px solid ${accent}` : st.header === "split" ? `1px solid #e4e0d8` : undefined }}
      >
        <div className={`flex gap-5 ${doc.brand.logoLayout === "center" ? "flex-col items-center" : doc.brand.logoLayout === "stacked" ? "flex-col" : "items-start justify-between"}`}>
          <div className={`flex gap-4 ${doc.brand.logoLayout === "left" ? "items-center" : "flex-col items-inherit"}`}>
            {headerDark && doc.brand.logoUrl ? <span className="rounded bg-white p-1.5">{logo}</span> : logo}
            <div>
              <p className="font-display font-extrabold" style={{ fontSize: px(st.titleSize * 0.8) }}>{doc.brand.companyName}</p>
              {doc.brand.tagline && <p className="opacity-80">{doc.brand.tagline}</p>}
            </div>
          </div>
          {doc.brand.contact.length > 0 && (
            <ul className={`space-y-0.5 opacity-90 ${doc.brand.logoLayout === "left" ? "text-right" : ""}`} style={{ fontSize: px(st.baseSize * 0.9) }}>
              {doc.brand.contact.map((c) => <li key={c.label}>{c.value}</li>)}
            </ul>
          )}
        </div>
      </header>
      {st.header === "dark" && <div style={{ height: 5, background: accent }} />}

      <div className={`px-[6%] ${st.compact ? "py-5" : "py-8"}`}>
        {/* Title block */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-4" style={{ borderColor: "#e4e0d8" }}>
          <div>
            <p className="font-semibold uppercase tracking-wider" style={{ color: accent, fontSize: px(st.baseSize * 0.85) }}>Proposal</p>
            <h1 className="font-display font-extrabold leading-tight" style={{ fontSize: px(st.titleSize), color: brand }}>{doc.meta.title}</h1>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5" style={{ fontSize: px(st.baseSize * 0.9) }}>
            <dt className="text-[#6b7686]">Proposal #</dt><dd className="text-right font-semibold">{doc.meta.number}</dd>
            <dt className="text-[#6b7686]">Date</dt><dd className="text-right">{doc.meta.date}</dd>
            {doc.meta.expires && (<><dt className="text-[#6b7686]">Valid until</dt><dd className="text-right">{doc.meta.expires}</dd></>)}
          </dl>
        </div>

        <div className={`grid gap-4 ${st.compact ? "mt-3" : "mt-5"} sm:grid-cols-2`}>
          <div>
            <p className="font-semibold uppercase tracking-wider text-[#6b7686]" style={{ fontSize: px(st.baseSize * 0.75) }}>Prepared for</p>
            <p className="font-semibold">{doc.customer.name}</p>
            {doc.customer.email && <p>{doc.customer.email}</p>}
            {doc.customer.phone && <p>{doc.customer.phone}</p>}
          </div>
          {doc.customer.projectAddress && (
            <div>
              <p className="font-semibold uppercase tracking-wider text-[#6b7686]" style={{ fontSize: px(st.baseSize * 0.75) }}>Project location</p>
              <p className="whitespace-pre-line">{doc.customer.projectAddress}</p>
            </div>
          )}
        </div>

        {doc.introduction && <Prose title={null} body={doc.introduction} gap={st.sectionGap} />}
        {doc.scopeOfWork && <Prose title="Scope of Work" body={doc.scopeOfWork} gap={st.sectionGap} color={brand} />}

        {/* Pricing */}
        <section style={{ marginTop: st.sectionGap * 1.6 }}>
          <h2 className="font-display font-bold" style={{ fontSize: px(st.baseSize * 1.3), color: brand }}>Pricing</h2>
          <div className="mt-2 space-y-3">
            {doc.pricing.displayMode === "project_total" ? (
              <div className="flex justify-between border-b py-2 font-semibold" style={{ borderColor: "#e4e0d8" }}>
                <span>{doc.pricing.projectLabel}</span><span className="tabular">{doc.pricing.subtotal}</span>
              </div>
            ) : (
              doc.pricing.sections.map((s, i) => <Section key={i} s={s} striped={st.tableStriped} bar={st.showSectionTotalsBar} brand={brand} px={px} base={st.baseSize} />)
            )}
          </div>
          <dl className="ml-auto mt-4 w-full max-w-xs space-y-1">
            {doc.pricing.adjustment && <Row k={doc.pricing.adjustment.label} v={doc.pricing.adjustment.amount} />}
            {(doc.pricing.tax || doc.pricing.adjustment) && <Row k="Subtotal" v={doc.pricing.subtotal} />}
            {doc.pricing.tax && <Row k={doc.pricing.tax.label} v={doc.pricing.tax.amount} />}
            <div className="flex justify-between rounded px-3 py-2 font-extrabold" style={{ background: brand, color: onColor(brand), fontSize: px(st.baseSize * 1.25) }}>
              <dt>Total</dt><dd className="tabular">{doc.pricing.total}</dd>
            </div>
          </dl>
        </section>

        {doc.allowances && <Prose title="Allowances" body={doc.allowances} gap={st.sectionGap} color={brand} />}
        {doc.exclusions && <Prose title="Exclusions" body={doc.exclusions} gap={st.sectionGap} color={brand} />}
        {doc.customerResponsibilities && <Prose title="Customer Responsibilities" body={doc.customerResponsibilities} gap={st.sectionGap} color={brand} />}
        {doc.schedule && <Prose title="Estimated Schedule" body={doc.schedule} gap={st.sectionGap} color={brand} />}

        {doc.paymentSchedule.length > 0 && (
          <section style={{ marginTop: st.sectionGap * 1.6 }}>
            <h2 className="font-display font-bold" style={{ fontSize: px(st.baseSize * 1.15), color: brand }}>Payment Schedule</h2>
            <table className="mt-2 w-full">
              <tbody>
                {doc.paymentSchedule.map((p, i) => (
                  <tr key={i} className="border-b" style={{ borderColor: "#eee9e0" }}>
                    <td className="py-1.5">{p.label}</td>
                    <td className="py-1.5 text-right text-[#6b7686]">{p.percent}%</td>
                    <td className="tabular py-1.5 text-right font-semibold">{p.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {doc.terms && <Prose title="Terms and Conditions" body={doc.terms} gap={st.sectionGap} color={brand} small />}

        {doc.signature && (
          <section className="grid gap-8 sm:grid-cols-2" style={{ marginTop: st.sectionGap * 2.2 }}>
            {["Customer acceptance", doc.brand.companyName].map((who) => (
              <div key={who}>
                <div className="h-10 border-b border-[#16202e]" />
                <div className="mt-1 flex justify-between text-[#6b7686]" style={{ fontSize: px(st.baseSize * 0.85) }}><span>{who}</span><span>Date</span></div>
              </div>
            ))}
          </section>
        )}
      </div>
      <footer className="border-t px-[6%] py-3 text-center text-[#6b7686]" style={{ borderColor: "#e4e0d8", fontSize: px(st.baseSize * 0.8) }}>{doc.footer}</footer>
    </article>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between px-3"><dt className="text-[#3b4656]">{k}</dt><dd className="tabular font-semibold">{v}</dd></div>;
}

function Prose({ title, body, gap, color, small }: { title: string | null; body: string; gap: number; color?: string; small?: boolean }) {
  return (
    <section style={{ marginTop: gap * 1.4 }}>
      {title && <h2 className="font-display font-bold" style={{ color, fontSize: "1.1em" }}>{title}</h2>}
      <p className={`mt-1 whitespace-pre-line text-[#3b4656] ${small ? "text-[0.9em]" : ""}`}>{body}</p>
    </section>
  );
}

function Section({ s, striped, bar, brand, px, base }: { s: ProposalSection; striped: boolean; bar: boolean; brand: string; px: (n: number) => string; base: number }) {
  const itemized = s.mode === "itemized";
  const hasQty = itemized && s.lines.some((l) => l.quantity);
  const hasUnit = itemized && s.lines.some((l) => l.unitPrice);
  const hasAmt = itemized && s.lines.some((l) => l.amount);
  return (
    <div className="break-inside-avoid">
      <div
        className="flex items-baseline justify-between gap-3 rounded px-2 py-1.5 font-semibold"
        style={bar ? { background: `${brand}14`, borderLeft: `3px solid ${brand}` } : { borderBottom: `1px solid ${brand}55` }}
      >
        <span>{s.title}</span>
        {s.amount && <span className="tabular">{s.amount}</span>}
      </div>
      {s.description && <p className="px-2 pt-1 text-[#3b4656]">{s.description}</p>}
      {s.lines.length > 0 && (
        <table className="mt-1 w-full" style={{ fontSize: px(base * 0.95) }}>
          {itemized && (hasQty || hasAmt) && (
            <thead>
              <tr className="text-left text-[#6b7686]" style={{ fontSize: px(base * 0.8) }}>
                <th className="px-2 py-1 font-semibold">Item</th>
                {hasQty && <th className="px-2 py-1 text-right font-semibold">Qty</th>}
                {hasUnit && <th className="px-2 py-1 text-right font-semibold">Unit price</th>}
                {hasAmt && <th className="px-2 py-1 text-right font-semibold">Amount</th>}
              </tr>
            </thead>
          )}
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={i} className="align-top" style={{ background: striped && i % 2 ? "#f6f4ef" : undefined, borderBottom: "1px solid #f0ece4" }}>
                <td className="px-2 py-1">
                  <span>{itemized ? l.name : `• ${l.name}`}</span>
                  {l.description && <span className="block text-[#6b7686]">{l.description}</span>}
                  {l.notes && <span className="block italic text-[#6b7686]">{l.notes}</span>}
                </td>
                {hasQty && <td className="tabular whitespace-nowrap px-2 py-1 text-right">{l.quantity} {l.unit}</td>}
                {hasUnit && <td className="tabular whitespace-nowrap px-2 py-1 text-right">{l.unitPrice}</td>}
                {hasAmt && <td className="tabular whitespace-nowrap px-2 py-1 text-right">{l.amount}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
