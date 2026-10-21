/**
 * Nav Icons
 *
 * Small stroke icons for the sidebar, drawn on a 20px grid so they share one
 * weight and optical size. Decorative: the link text carries the meaning.
 */

type IconProps = { className?: string };

function Icon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="5.5" height="7" rx="1.25" />
      <rect x="11.5" y="3" width="5.5" height="4" rx="1.25" />
      <rect x="11.5" y="10" width="5.5" height="7" rx="1.25" />
      <rect x="3" y="13" width="5.5" height="4" rx="1.25" />
    </Icon>
  );
}

export function OverviewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 17h14" />
      <path d="M5.5 13.5v-3" />
      <path d="M10 13.5V6" />
      <path d="M14.5 13.5v-5" />
    </Icon>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4.5h12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-3.5 2.5V14H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" />
      <path d="M6.5 8h7" />
      <path d="M6.5 11h4" />
    </Icon>
  );
}

export function CampaignsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 3 4.5 11H10l-1 6 6.5-8H10l1-6Z" />
    </Icon>
  );
}

export function LogsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.5 5.5H16" />
      <path d="M7.5 10H16" />
      <path d="M7.5 14.5H16" />
      <path d="M4 5.5h.01" />
      <path d="M4 10h.01" />
      <path d="M4 14.5h.01" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6h7" />
      <path d="M14 6h3" />
      <circle cx="12" cy="6" r="2" />
      <path d="M3 14h3" />
      <path d="M10 14h7" />
      <circle cx="8" cy="14" r="2" />
    </Icon>
  );
}

export function DiagnosticsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 10h3l2-5 4 10 2-5h4" />
    </Icon>
  );
}
