export const metadata = {
  title: "Support the Index · AI Mood Index",
};

// UPI deep links — these open the respective app on Android devices that have
// it installed. On desktop or iOS they'll simply fail to open; the page also
// exposes the raw UPI ID for manual transfer.
const PAYMENT_LINKS: { label: string; href: string }[] = [
  {
    label: "₹100 on Google Pay",
    href: "tez://upi/pay?pa=username.aayush-1@okicici&pn=Aayush&am=100&cu=INR&tn=Lived%20Model%20Index",
  },
  {
    label: "₹500 on Google Pay",
    href: "tez://upi/pay?pa=username.aayush-1@okicici&pn=Aayush&am=500&cu=INR&tn=Lived%20Model%20Index",
  },
  {
    label: "Custom amount on Google Pay",
    href: "tez://upi/pay?pa=username.aayush-1@okicici&pn=Aayush&cu=INR&tn=Lived%20Model%20Index",
  },
  {
    label: "₹100 on PayTM",
    href: "paytmmp://pay?pa=username.aayush-1@okicici&pn=Aayush&am=100&cu=INR&tn=Lived%20Model%20Index",
  },
  {
    label: "₹500 on PayTM",
    href: "paytmmp://pay?pa=username.aayush-1@okicici&pn=Aayush&am=500&cu=INR&tn=Lived%20Model%20Index",
  },
  {
    label: "Custom amount on PayTM",
    href: "paytmmp://pay?pa=username.aayush-1@okicici&pn=Aayush&cu=INR&tn=Lived%20Model%20Index",
  },
];

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-[680px] space-y-8">
      <section>
        <h1 className="font-serif text-[40px] font-medium leading-[1.05] tracking-tight text-[var(--foreground)]">
          Support the Index!
        </h1>
      </section>

      <section className="space-y-4 text-[17px] leading-[1.6] text-[var(--ink-2)]">
        <p>
          The AI Mood Index is for the public, by the public. It lives outside
          any paywall or login: free to read, free to cite, free to fork. The
          work that keeps it going, though, costs money: every day, the same
          battery is put to every model in the panel, and every answer is scored
          by a judge model. The wider the panel, the more interesting the record
          becomes over time. Any monetary contribution you send here is routed
          straight back into API credits so more models can be added to the
          daily run.
        </p>
        <p>
          Contributions support API costs for adding more LLMs. Not tax-deductible;
          I&apos;m an individual, not a registered nonprofit.
        </p>
        <p className="text-[14px] leading-[1.55] text-[var(--muted)]">
          <span className="font-medium uppercase tracking-[0.14em] text-[var(--foreground)]">
            Transparency
          </span>
          {" · "}
          Contributions cover API credits for additional models in the daily
          panel; I&apos;m an individual, not a registered charity.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {PAYMENT_LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center text-[13.5px] font-medium text-[var(--foreground)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {link.label}
          </a>
        ))}
      </section>

      <p className="text-[14px] leading-[1.6] text-[var(--ink-2)]">
        You can also transfer your monetary contribution to this UPI ID:{" "}
        <code className="rounded-sm bg-[var(--surface)] px-1.5 py-0.5 text-[13px]">
          username.aayush-1@okicici
        </code>
      </p>
    </div>
  );
}
