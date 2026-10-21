import BrandLogo from "@/components/brand-logo";

/**
 * Entry Shell
 *
 * Frame for the screens people see before the dashboard (login, email check,
 * invitations): the Media Kit backdrop, the wordmark, and one narrow column.
 */

interface EntryShellProps {
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}

export default function EntryShell({ eyebrow, title, description, children }: EntryShellProps) {
  return (
    <div className="brand-backdrop flex min-h-screen flex-col">
      <header className="flex h-16 items-center px-6 sm:px-10">
        <BrandLogo />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-20 sm:px-6">
        <div className="animate-fade-in w-full max-w-sm">
          {eyebrow && (
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="mt-3 text-sm leading-relaxed text-muted">{description}</p>
          )}
          <div className="mt-8">{children}</div>
        </div>
      </main>

      <footer className="px-6 pb-6 sm:px-10">
        <p className="eyebrow">© IPC</p>
      </footer>
    </div>
  );
}
