export const metadata = {
  title: "About · Lived Model Index",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[680px] space-y-6">
      <section>
        <h1 className="font-serif text-[40px] font-medium leading-[1.05] tracking-tight text-[var(--foreground)]">
          About the Lived Model Index
        </h1>
      </section>

      <section className="space-y-4 text-[17px] leading-[1.6] text-[var(--ink-2)]">
        <p>
          The Lived Model Index was created by{" "}
          <a
            href="https://www.linkedin.com/in/aayush-agarwal-besci/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] underline decoration-[var(--rule)] decoration-1 underline-offset-4 hover:decoration-[var(--accent)]"
          >
            Aayush Agarwal
          </a>
          .
        </p>
      </section>
    </div>
  );
}
